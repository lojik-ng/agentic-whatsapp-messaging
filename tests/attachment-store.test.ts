import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createDatabase } from '../src/storage/database.js';
import { AttachmentStore } from '../src/storage/attachment-store.js';
import { AttachmentMetadata } from '../src/types.js';

describe('AttachmentStore Tests', () => {
  let db: any;
  let store: AttachmentStore;
  const testDir = path.resolve('./data/test_attachments_' + Date.now());

  beforeEach(() => {
    db = createDatabase(':memory:');
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
    store = new AttachmentStore(db, testDir);

    // Seed dummy parent message
    db.prepare(`
      INSERT INTO messages (id, chat_id, sender, recipient, timestamp, message_type, created_at)
      VALUES ('MSG_ATT_1', 'chat1', 's1', 'me', 1700000000, 'image', 1700000000)
    `).run();
  });

  it('should save and retrieve attachment metadata', () => {
    const meta: AttachmentMetadata = {
      id: 'ATT_1',
      messageId: 'MSG_ATT_1',
      chatId: 'chat1@s.whatsapp.net',
      mediaType: 'image',
      filename: 'photo.jpg',
      mimeType: 'image/jpeg',
      fileSize: 1024,
      caption: 'Vacation picture',
      downloadStatus: 'pending',
    };

    store.saveAttachment(meta);

    const retrieved = store.getAttachmentById('ATT_1');
    assert.ok(retrieved);
    assert.equal(retrieved.id, 'ATT_1');
    assert.equal(retrieved.filename, 'photo.jpg');
    assert.equal(retrieved.caption, 'Vacation picture');
    assert.equal(retrieved.downloadStatus, 'pending');
  });

  it('should save downloaded file buffer, compute sha256 checksum and update status', () => {
    const meta: AttachmentMetadata = {
      id: 'ATT_1',
      messageId: 'MSG_ATT_1',
      chatId: 'chat1@s.whatsapp.net',
      mediaType: 'image',
      filename: 'photo.jpg',
      mimeType: 'image/jpeg',
      fileSize: 0,
      downloadStatus: 'pending',
    };
    store.saveAttachment(meta);

    const fileContent = Buffer.from('FAKE_IMAGE_DATA_BINARY_PAYLOAD');
    const expectedChecksum = crypto.createHash('sha256').update(fileContent).digest('hex');

    const updated = store.saveDownloadedFile(
      'ATT_1',
      fileContent,
      'chat1@s.whatsapp.net',
      'MSG_ATT_1',
      'photo.jpg'
    );

    assert.equal(updated.downloadStatus, 'completed');
    assert.equal(updated.checksum, expectedChecksum);
    assert.equal(updated.fileSize, fileContent.length);
    assert.ok(updated.localPath);
    assert.ok(fs.existsSync(updated.localPath));
    assert.equal(fs.readFileSync(updated.localPath).toString(), 'FAKE_IMAGE_DATA_BINARY_PAYLOAD');
  });

  it('should record download failure with error message', () => {
    const meta: AttachmentMetadata = {
      id: 'ATT_ERR',
      messageId: 'MSG_ATT_1',
      chatId: 'chat1',
      mediaType: 'document',
      filename: 'doc.pdf',
      mimeType: 'application/pdf',
      fileSize: 100,
      downloadStatus: 'pending',
    };
    store.saveAttachment(meta);

    store.recordDownloadFailure('ATT_ERR', 'Network 404: Media expired on WhatsApp servers');

    const retrieved = store.getAttachmentById('ATT_ERR');
    assert.equal(retrieved?.downloadStatus, 'failed');
    assert.equal(retrieved?.errorMessage, 'Network 404: Media expired on WhatsApp servers');
  });
});
