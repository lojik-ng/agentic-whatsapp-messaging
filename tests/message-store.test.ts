import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/storage/database.js';
import { MessageStore } from '../src/storage/message-store.js';
import { Message } from '../src/types.js';

describe('MessageStore Tests', () => {
  let db: any;
  let store: MessageStore;

  beforeEach(() => {
    db = createDatabase(':memory:');
    store = new MessageStore(db);
  });

  it('should save and retrieve a message correctly', () => {
    const msg: Message = {
      messageId: 'MSG_1',
      chatId: '15551234567@s.whatsapp.net',
      sender: '15551234567@s.whatsapp.net',
      senderName: 'Alice',
      recipient: 'me@s.whatsapp.net',
      fromMe: false,
      timestamp: 1726000000,
      isoDate: new Date(1726000000 * 1000).toISOString(),
      messageType: 'text',
      text: 'Hello from Alice!',
      isGroup: false,
      isRead: false,
      hasAttachment: false,
    };

    store.saveMessage(msg);

    const retrieved = store.getMessage('MSG_1');
    assert.ok(retrieved);
    assert.equal(retrieved.messageId, 'MSG_1');
    assert.equal(retrieved.senderName, 'Alice');
    assert.equal(retrieved.text, 'Hello from Alice!');
    assert.equal(retrieved.isRead, false);
  });

  it('should deduplicate messages on conflict without duplicate key error', () => {
    const msg: Message = {
      messageId: 'MSG_DUP',
      chatId: '15551234567@s.whatsapp.net',
      sender: '15551234567@s.whatsapp.net',
      recipient: 'me@s.whatsapp.net',
      fromMe: false,
      timestamp: 1726000000,
      isoDate: new Date(1726000000 * 1000).toISOString(),
      messageType: 'text',
      text: 'Original Text',
      isGroup: false,
      isRead: false,
      hasAttachment: false,
    };

    store.saveMessage(msg);

    // Save updated version
    const updatedMsg = { ...msg, text: 'Edited Text', senderName: 'Alice Updated' };
    store.saveMessage(updatedMsg);

    const retrieved = store.getMessage('MSG_DUP');
    assert.ok(retrieved);
    assert.equal(retrieved.text, 'Edited Text');
    assert.equal(retrieved.senderName, 'Alice Updated');
  });

  it('should support quoted message information', () => {
    const replyMsg: Message = {
      messageId: 'MSG_REPLY',
      chatId: '15551234567@s.whatsapp.net',
      sender: 'me@s.whatsapp.net',
      recipient: '15551234567@s.whatsapp.net',
      fromMe: true,
      timestamp: 1726000100,
      isoDate: new Date(1726000100 * 1000).toISOString(),
      messageType: 'text',
      text: 'Sounds great!',
      isGroup: false,
      quotedMessage: {
        messageId: 'MSG_1',
        sender: '15551234567@s.whatsapp.net',
        text: 'Hello from Alice!',
      },
      isRead: true,
      hasAttachment: false,
    };

    store.saveMessage(replyMsg);

    const retrieved = store.getMessage('MSG_REPLY');
    assert.ok(retrieved?.quotedMessage);
    assert.equal(retrieved.quotedMessage.messageId, 'MSG_1');
    assert.equal(retrieved.quotedMessage.text, 'Hello from Alice!');
  });

  it('should mark message and chat as read', () => {
    const msg: Message = {
      messageId: 'MSG_UNREAD',
      chatId: 'chat_test@s.whatsapp.net',
      sender: 'sender@s.whatsapp.net',
      recipient: 'me@s.whatsapp.net',
      fromMe: false,
      timestamp: 1726000000,
      isoDate: new Date(1726000000 * 1000).toISOString(),
      messageType: 'text',
      text: 'Unread test',
      isGroup: false,
      isRead: false,
      hasAttachment: false,
    };

    store.saveMessage(msg);
    assert.equal(store.getMessage('MSG_UNREAD')?.isRead, false);

    store.markAsRead('MSG_UNREAD');
    assert.equal(store.getMessage('MSG_UNREAD')?.isRead, true);
  });

  it('should manage and search contacts', () => {
    store.saveContact({
      jid: '12345@s.whatsapp.net',
      name: 'Bob Builder',
      notify: 'Bob',
      phoneNumber: '12345',
    });
    store.saveContact({
      jid: '67890@s.whatsapp.net',
      name: 'Charlie Brown',
      notify: 'Chuck',
      phoneNumber: '67890',
    });

    const contacts = store.getContacts();
    assert.equal(contacts.length, 2);

    const searchRes = store.searchContacts('builder');
    assert.equal(searchRes.length, 1);
    assert.equal(searchRes[0].name, 'Bob Builder');
  });
});
