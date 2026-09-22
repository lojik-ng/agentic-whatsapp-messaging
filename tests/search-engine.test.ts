import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/storage/database.js';
import { MessageStore } from '../src/storage/message-store.js';
import { SearchEngine } from '../src/storage/search-engine.js';
import { Message } from '../src/types.js';

describe('SearchEngine Multi-Criteria & FTS5 Tests', () => {
  let db: any;
  let messageStore: MessageStore;
  let searchEngine: SearchEngine;

  beforeEach(() => {
    db = createDatabase(':memory:');
    messageStore = new MessageStore(db);
    searchEngine = new SearchEngine(db);

    // Seed test dataset covering diverse messages
    const sampleMessages: Message[] = [
      {
        messageId: 'M1',
        chatId: '15551111111@s.whatsapp.net',
        sender: '15551111111@s.whatsapp.net',
        senderName: 'John Doe',
        recipient: 'me@s.whatsapp.net',
        fromMe: false,
        timestamp: 1725500000, // 2024-09-05
        isoDate: new Date(1725500000 * 1000).toISOString(),
        messageType: 'text',
        text: 'Hi, please send the September payment receipt.',
        isGroup: false,
        isRead: true,
        hasAttachment: false,
      },
      {
        messageId: 'M2',
        chatId: '15551111111@s.whatsapp.net',
        sender: '15551111111@s.whatsapp.net',
        senderName: 'John Doe',
        recipient: 'me@s.whatsapp.net',
        fromMe: false,
        timestamp: 1726000000, // 2024-09-10
        isoDate: new Date(1726000000 * 1000).toISOString(),
        messageType: 'document',
        text: 'Attached invoice for the payment.',
        isGroup: false,
        isRead: false,
        hasAttachment: true,
        attachment: {
          id: 'ATT_1',
          messageId: 'M2',
          chatId: '15551111111@s.whatsapp.net',
          mediaType: 'document',
          filename: 'invoice_sep.pdf',
          mimeType: 'application/pdf',
          fileSize: 45000,
          caption: 'Invoice PDF',
          downloadStatus: 'completed',
          localPath: '/tmp/invoice_sep.pdf',
        },
      },
      {
        messageId: 'M3',
        chatId: 'group_school@g.us',
        sender: '15552222222@s.whatsapp.net',
        senderName: 'Principal Skinner',
        recipient: 'group_school@g.us',
        fromMe: false,
        timestamp: 1726500000, // 2024-09-16
        isoDate: new Date(1726500000 * 1000).toISOString(),
        messageType: 'text',
        text: 'Welcome to ABC School meeting today.',
        isGroup: true,
        groupName: 'ABC School Parents',
        isRead: false,
        hasAttachment: false,
      },
      {
        messageId: 'M4',
        chatId: 'group_school@g.us',
        sender: '15553333333@s.whatsapp.net',
        senderName: 'Mrs Krabappel',
        recipient: 'group_school@g.us',
        fromMe: false,
        timestamp: 1726600000, // 2024-09-17
        isoDate: new Date(1726600000 * 1000).toISOString(),
        messageType: 'image',
        text: 'Photo of the school timetable.',
        isGroup: true,
        groupName: 'ABC School Parents',
        isRead: true,
        hasAttachment: true,
        attachment: {
          id: 'ATT_2',
          messageId: 'M4',
          chatId: 'group_school@g.us',
          mediaType: 'image',
          filename: 'timetable.jpg',
          mimeType: 'image/jpeg',
          fileSize: 120000,
          caption: 'Timetable image',
          downloadStatus: 'pending',
        },
      },
    ];

    sampleMessages.forEach((m) => messageStore.saveMessage(m));
  });

  it('should search by FTS5 keyword', () => {
    const results = searchEngine.searchMessages({ query: 'payment' });
    assert.equal(results.total, 2);
    assert.ok(results.messages.some((m) => m.messageId === 'M1'));
    assert.ok(results.messages.some((m) => m.messageId === 'M2'));
  });

  it('should search by exact phrase', () => {
    const results = searchEngine.searchMessages({ exactPhrase: 'payment receipt' });
    assert.equal(results.total, 1);
    assert.equal(results.messages[0].messageId, 'M1');
  });

  it('should filter by sender name and date range (1 Sep - 15 Sep)', () => {
    const results = searchEngine.searchMessages({
      senderName: 'John',
      since: 1725148800, // 2024-09-01
      until: 1726444799, // 2024-09-15 23:59:59
    });

    assert.equal(results.total, 2);
    assert.ok(results.messages.every((m) => m.senderName === 'John Doe'));
  });

  it('should filter by group vs private chat', () => {
    const groupRes = searchEngine.searchMessages({ isGroup: true });
    assert.equal(groupRes.total, 2);
    assert.ok(groupRes.messages.every((m) => m.isGroup === true));

    const privateRes = searchEngine.searchMessages({ isGroup: false });
    assert.equal(privateRes.total, 2);
    assert.ok(privateRes.messages.every((m) => m.isGroup === false));
  });

  it('should filter by attachment and media type', () => {
    const docRes = searchEngine.searchMessages({
      hasAttachment: true,
      attachmentType: 'document',
    });
    assert.equal(docRes.total, 1);
    assert.equal(docRes.messages[0].messageId, 'M2');
    assert.equal(docRes.messages[0].attachment?.filename, 'invoice_sep.pdf');

    const imgRes = searchEngine.searchMessages({
      hasAttachment: true,
      attachmentType: 'image',
    });
    assert.equal(imgRes.total, 1);
    assert.equal(imgRes.messages[0].messageId, 'M4');
  });

  it('should filter by read/unread status', () => {
    const unread = searchEngine.searchMessages({ isRead: false });
    assert.equal(unread.total, 2);
    assert.ok(unread.messages.some((m) => m.messageId === 'M2'));
    assert.ok(unread.messages.some((m) => m.messageId === 'M3'));

    const read = searchEngine.searchMessages({ isRead: true });
    assert.equal(read.total, 2);
    assert.ok(read.messages.some((m) => m.messageId === 'M1'));
    assert.ok(read.messages.some((m) => m.messageId === 'M4'));
  });

  it('should support pagination (limit, offset) and sort ordering', () => {
    // Newest first (descending)
    const page1 = searchEngine.searchMessages({ limit: 2, offset: 0, sort: 'desc' });
    assert.equal(page1.messages.length, 2);
    assert.equal(page1.messages[0].messageId, 'M4'); // latest (1726600000)
    assert.equal(page1.messages[1].messageId, 'M3'); // (1726500000)
    assert.equal(page1.hasMore, true);

    const page2 = searchEngine.searchMessages({ limit: 2, offset: 2, sort: 'desc' });
    assert.equal(page2.messages.length, 2);
    assert.equal(page2.messages[0].messageId, 'M2');
    assert.equal(page2.messages[1].messageId, 'M1');
    assert.equal(page2.hasMore, false);

    // Oldest first (ascending)
    const ascRes = searchEngine.searchMessages({ limit: 1, offset: 0, sort: 'asc' });
    assert.equal(ascRes.messages[0].messageId, 'M1');
  });

  it('should find messages by chat name or keyword', () => {
    const res = searchEngine.searchMessages({ chat: 'ABC School' });
    assert.equal(res.total, 2);
  });
});
