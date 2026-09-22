import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/storage/database.js';

describe('SQLite Database & Schema Tests', () => {
  it('should initialize tables, indexes, and FTS5 virtual table in memory', () => {
    const db = createDatabase(':memory:');

    // Verify tables exist
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all()
      .map((r: any) => r.name);

    assert.ok(tables.includes('messages'), 'messages table should exist');
    assert.ok(tables.includes('attachments'), 'attachments table should exist');
    assert.ok(tables.includes('chats'), 'chats table should exist');
    assert.ok(tables.includes('contacts'), 'contacts table should exist');
    assert.ok(tables.includes('messages_fts'), 'messages_fts table should exist');

    db.close();
  });

  it('should automatically sync messages into messages_fts via triggers', () => {
    const db = createDatabase(':memory:');

    // Insert a message
    db.prepare(`
      INSERT INTO messages (
        id, chat_id, sender, recipient, timestamp, message_type, text, created_at
      ) VALUES (
        'msg100', 'chat100@s.whatsapp.net', 'sender100', 'me', 1700000000, 'text', 'payment confirmation received', 1700000000
      )
    `).run();

    // Query FTS table
    const ftsResults = db
      .prepare('SELECT * FROM messages_fts WHERE messages_fts MATCH ?')
      .all('payment') as any[];

    assert.equal(ftsResults.length, 1);
    assert.equal(ftsResults[0].message_id, 'msg100');
    assert.ok(ftsResults[0].text.includes('payment'));

    // Update message text
    db.prepare("UPDATE messages SET text = 'revised agreement contract' WHERE id = 'msg100'").run();

    // Query for contract
    const contractResults = db
      .prepare('SELECT * FROM messages_fts WHERE messages_fts MATCH ?')
      .all('contract') as any[];
    assert.equal(contractResults.length, 1);

    // Delete message
    db.prepare("DELETE FROM messages WHERE id = 'msg100'").run();
    const afterDelete = db
      .prepare('SELECT * FROM messages_fts WHERE message_id = ?')
      .all('msg100');
    assert.equal(afterDelete.length, 0);

    db.close();
  });

  it('should enforce foreign key constraint and cascade deletion', () => {
    const db = createDatabase(':memory:');

    // Insert parent message
    db.prepare(`
      INSERT INTO messages (
        id, chat_id, sender, recipient, timestamp, message_type, text, created_at
      ) VALUES ('msg_parent', 'chat1', 's1', 'me', 1700000000, 'document', 'Here is invoice', 1700000000)
    `).run();

    // Insert attachment referencing parent message
    db.prepare(`
      INSERT INTO attachments (
        id, message_id, chat_id, media_type, filename, mime_type, file_size
      ) VALUES ('att_parent', 'msg_parent', 'chat1', 'document', 'invoice.pdf', 'application/pdf', 1234)
    `).run();

    const attBefore = db.prepare("SELECT * FROM attachments WHERE id = 'att_parent'").get();
    assert.ok(attBefore);

    // Delete parent message
    db.prepare("DELETE FROM messages WHERE id = 'msg_parent'").run();

    // Child attachment should be cascade deleted
    const attAfter = db.prepare("SELECT * FROM attachments WHERE id = 'att_parent'").get();
    assert.equal(attAfter, undefined);

    db.close();
  });
});
