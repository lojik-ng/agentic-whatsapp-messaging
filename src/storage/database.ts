import DatabaseConstructor, { Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { config, ensureDirectories } from '../config.js';

export function createDatabase(dbPath: string = config.dbPath): DatabaseType {
  // If not memory database, ensure parent directory exists
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new DatabaseConstructor(dbPath);

  // Set performant pragmas
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');

  // Initialize schema
  initSchema(db);

  return db;
}

function initSchema(db: DatabaseType): void {
  db.exec(`
    -- Messages table
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      chat_id TEXT NOT NULL,
      sender TEXT NOT NULL,
      sender_name TEXT,
      recipient TEXT NOT NULL,
      from_me INTEGER NOT NULL DEFAULT 0,
      timestamp INTEGER NOT NULL,
      message_type TEXT NOT NULL,
      text TEXT NOT NULL DEFAULT '',
      is_group INTEGER NOT NULL DEFAULT 0,
      group_name TEXT,
      quoted_message_id TEXT,
      quoted_sender TEXT,
      quoted_text TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      has_attachment INTEGER NOT NULL DEFAULT 0,
      raw_json TEXT,
      created_at INTEGER NOT NULL
    );

    -- Attachments table
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      media_type TEXT NOT NULL,
      filename TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      caption TEXT,
      local_path TEXT,
      download_status TEXT NOT NULL DEFAULT 'pending',
      downloaded_at TEXT,
      checksum TEXT,
      error_message TEXT,
      FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
    );

    -- Chats table
    CREATE TABLE IF NOT EXISTS chats (
      chat_id TEXT PRIMARY KEY,
      name TEXT,
      is_group INTEGER NOT NULL DEFAULT 0,
      unread_count INTEGER NOT NULL DEFAULT 0,
      last_message_timestamp INTEGER,
      last_message_text TEXT
    );

    -- Contacts table
    CREATE TABLE IF NOT EXISTS contacts (
      jid TEXT PRIMARY KEY,
      name TEXT,
      notify TEXT,
      phone_number TEXT
    );

    -- Indexes for efficient queries
    CREATE INDEX IF NOT EXISTS idx_messages_chat_ts ON messages(chat_id, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_sender_ts ON messages(sender, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_type_ts ON messages(message_type, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_has_attachment ON messages(has_attachment, timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_attachments_message_id ON attachments(message_id);
    CREATE INDEX IF NOT EXISTS idx_attachments_media_type ON attachments(media_type);

    -- FTS5 Full-Text Search Virtual Table
    CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      message_id UNINDEXED,
      chat_id UNINDEXED,
      sender_name,
      text,
      filename,
      caption
    );

    -- Triggers to synchronize messages into messages_fts
    CREATE TRIGGER IF NOT EXISTS trg_messages_ai AFTER INSERT ON messages
    BEGIN
      INSERT INTO messages_fts(message_id, chat_id, sender_name, text, filename, caption)
      VALUES (
        new.id,
        new.chat_id,
        COALESCE(new.sender_name, ''),
        COALESCE(new.text, ''),
        '',
        ''
      );
    END;

    CREATE TRIGGER IF NOT EXISTS trg_messages_ad AFTER DELETE ON messages
    BEGIN
      DELETE FROM messages_fts WHERE message_id = old.id;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_messages_au AFTER UPDATE ON messages
    BEGIN
      UPDATE messages_fts
      SET sender_name = COALESCE(new.sender_name, ''),
          text = COALESCE(new.text, '')
      WHERE message_id = new.id;
    END;

    -- Trigger when an attachment is inserted or updated, update FTS filename and caption
    CREATE TRIGGER IF NOT EXISTS trg_attachments_ai AFTER INSERT ON attachments
    BEGIN
      UPDATE messages_fts
      SET filename = COALESCE(new.filename, ''),
          caption = COALESCE(new.caption, '')
      WHERE message_id = new.message_id;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_attachments_au AFTER UPDATE ON attachments
    BEGIN
      UPDATE messages_fts
      SET filename = COALESCE(new.filename, ''),
          caption = COALESCE(new.caption, '')
      WHERE message_id = new.message_id;
    END;
  `);
}
