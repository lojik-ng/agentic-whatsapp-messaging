import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { WhatsAppSkill } from '../src/skill/operations.js';
import { createDatabase } from '../src/storage/database.js';
import { createMockWASocket } from './mock-baileys.js';

describe('WhatsAppSkill End-to-End Operations Tests', () => {
  let skill: WhatsAppSkill;
  let mockSocket: any;
  let ev: any;
  const testDir = path.resolve('./data/test_ops_' + Date.now());

  beforeEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    fs.mkdirSync(testDir, { recursive: true });

    const db = createDatabase(':memory:');
    skill = new WhatsAppSkill({
      db,
      authDir: path.join(testDir, 'auth'),
      attachmentsDir: path.join(testDir, 'attachments'),
    });

    const mock = createMockWASocket({ registered: false, pairingCode: 'TEST1234' });
    mockSocket = mock.mockSocket;
    ev = mock.ev;

    // Inject mock socket into connection manager for isolated end-to-end testing
    (skill as any).connectionManager.socket = mockSocket;
    (skill as any).connectionManager.setState('Connected');
    (skill as any).eventHandler.bindSocket(mockSocket);
  });

  it('should return initial connected status with mock user', async () => {
    const status = await skill.getConnectionStatus();
    assert.equal(status.state, 'Connected');
    assert.ok(status.user?.id.includes('15551234567'));
  });

  it('should send a text message and persist it to SQLite index', async () => {
    const sent = await skill.sendMessage('+15559876543', 'Hello from autonomous test agent!');

    assert.ok(sent);
    assert.ok(sent.messageId);
    assert.equal(sent.text, 'Hello from autonomous test agent!');
    assert.equal(sent.fromMe, true);
    assert.equal(sent.chatId, '15559876543@s.whatsapp.net');

    // Retrieve from store to ensure persisted
    const stored = await skill.getMessage(sent.messageId);
    assert.ok(stored);
    assert.equal(stored.text, 'Hello from autonomous test agent!');
  });

  it('should reply to a message with quoted message context', async () => {
    // 1. Seed incoming message
    const incoming = {
      key: {
        id: 'MSG_INCOMING_1',
        remoteJid: '15558888888@s.whatsapp.net',
        fromMe: false,
      },
      messageTimestamp: Math.floor(Date.now() / 1000),
      pushName: 'Charlie',
      message: {
        conversation: 'Can you send me the latest report?',
      },
    };

    await (skill as any).eventHandler.handleIncomingMessage(incoming, mockSocket);

    // 2. Reply to it
    const reply = await skill.replyToMessage('MSG_INCOMING_1', 'Sure, sending it right now.');
    assert.ok(reply);
    assert.equal(reply.text, 'Sure, sending it right now.');
    assert.equal(reply.chatId, '15558888888@s.whatsapp.net');
    assert.ok(reply.quotedMessage);
    assert.equal(reply.quotedMessage.messageId, 'MSG_INCOMING_1');
    assert.equal(reply.quotedMessage.text, 'Can you send me the latest report?');
  });

  it('should send an attachment and save local metadata and file', async () => {
    const dummyFile = path.join(testDir, 'sample_contract.pdf');
    fs.writeFileSync(dummyFile, 'PDF_MOCK_CONTENT_ABC_123');

    const sent = await skill.sendAttachment(
      '+15559876543',
      dummyFile,
      'Signed agreement document',
      { fileName: 'Contract_2026.pdf' }
    );

    assert.ok(sent);
    assert.equal(sent.hasAttachment, true);
    assert.ok(sent.attachment);
    assert.equal(sent.attachment.filename, 'Contract_2026.pdf');
    assert.equal(sent.attachment.mediaType, 'document');
    assert.equal(sent.attachment.caption, 'Signed agreement document');

    // Verify search engine can find this document attachment
    const searchRes = await skill.searchMessages({
      hasAttachment: true,
      attachmentType: 'document',
    });
    assert.equal(searchRes.total, 1);
    assert.equal(searchRes.messages[0].messageId, sent.messageId);
  });

  it('should reply with an attachment', async () => {
    // Seed incoming question
    const incoming = {
      key: {
        id: 'MSG_REQ_IMG',
        remoteJid: '15557777777@s.whatsapp.net',
        fromMe: false,
      },
      messageTimestamp: Math.floor(Date.now() / 1000),
      message: { conversation: 'Do you have the receipt photo?' },
    };
    await (skill as any).eventHandler.handleIncomingMessage(incoming, mockSocket);

    const imageBuffer = Buffer.from('FAKE_PNG_BYTES');
    const sent = await skill.replyWithAttachment(
      'MSG_REQ_IMG',
      imageBuffer,
      'Here is the receipt',
      { fileName: 'receipt.png', mediaType: 'image' }
    );

    assert.ok(sent);
    assert.equal(sent.hasAttachment, true);
    assert.equal(sent.quotedMessage?.messageId, 'MSG_REQ_IMG');
    assert.equal(sent.attachment?.mediaType, 'image');
  });

  it('should throw clear error when replying to non-existent message', async () => {
    await assert.rejects(
      async () => skill.replyToMessage('NON_EXISTENT_ID', 'Hello'),
      /Cannot reply: message with ID "NON_EXISTENT_ID" was not found/
    );
  });

  it('should throw clear error when downloading attachment from message without media', async () => {
    const textMsg = await skill.sendMessage('+15551234567', 'Plain text message');
    await assert.rejects(
      async () => skill.downloadAttachment(textMsg.messageId),
      /does not contain any media attachment/
    );
  });

  it('should handle disconnectWhatsApp cleanly', async () => {
    await skill.disconnectWhatsApp();
    const status = await skill.getConnectionStatus();
    assert.equal(status.state, 'Disconnected');
  });
});
