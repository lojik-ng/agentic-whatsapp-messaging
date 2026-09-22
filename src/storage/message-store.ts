import { Database as DatabaseType } from 'better-sqlite3';
import { Message, Chat, Contact, MessageType } from '../types.js';
import { AttachmentStore } from './attachment-store.js';

export class MessageStore {
  private attachmentStore: AttachmentStore;

  constructor(
    private db: DatabaseType,
    attachmentStore?: AttachmentStore
  ) {
    this.attachmentStore = attachmentStore || new AttachmentStore(db);
  }

  /**
   * Save or update a message with deduplication
   */
  saveMessage(msg: Message, rawJson?: any): void {
    const stmt = this.db.prepare(`
      INSERT INTO messages (
        id, chat_id, sender, sender_name, recipient, from_me,
        timestamp, message_type, text, is_group, group_name,
        quoted_message_id, quoted_sender, quoted_text, is_read,
        has_attachment, raw_json, created_at
      ) VALUES (
        @id, @chatId, @sender, @senderName, @recipient, @fromMe,
        @timestamp, @messageType, @text, @isGroup, @groupName,
        @quotedMessageId, @quotedSender, @quotedText, @isRead,
        @hasAttachment, @rawJson, @createdAt
      )
      ON CONFLICT(id) DO UPDATE SET
        sender_name = COALESCE(excluded.sender_name, messages.sender_name),
        text = excluded.text,
        is_read = CASE WHEN excluded.is_read = 1 THEN 1 ELSE messages.is_read END,
        has_attachment = excluded.has_attachment,
        group_name = COALESCE(excluded.group_name, messages.group_name)
    `);

    stmt.run({
      id: String(msg.messageId),
      chatId: String(msg.chatId),
      sender: String(msg.sender),
      senderName: msg.senderName ? String(msg.senderName) : null,
      recipient: String(msg.recipient),
      fromMe: msg.fromMe ? 1 : 0,
      timestamp: Number(msg.timestamp) || Math.floor(Date.now() / 1000),
      messageType: String(msg.messageType),
      text: typeof msg.text === 'string' ? msg.text : (msg.text ? String(msg.text) : ''),
      isGroup: msg.isGroup ? 1 : 0,
      groupName: msg.groupName ? String(msg.groupName) : null,
      quotedMessageId: msg.quotedMessage?.messageId ? String(msg.quotedMessage.messageId) : null,
      quotedSender: msg.quotedMessage?.sender ? String(msg.quotedMessage.sender) : null,
      quotedText: msg.quotedMessage?.text ? String(msg.quotedMessage.text) : null,
      isRead: msg.isRead ? 1 : 0,
      hasAttachment: msg.hasAttachment ? 1 : 0,
      rawJson: rawJson ? JSON.stringify(rawJson) : (msg.rawJson || null),
      createdAt: Math.floor(Date.now() / 1000),
    });

    // If message includes attachment, save attachment metadata
    if (msg.attachment) {
      this.attachmentStore.saveAttachment(msg.attachment);
    }

    // Automatically update or record chat entry
    this.updateChatFromMessage(msg);
  }

  /**
   * Get single message by ID
   */
  getMessage(messageId: string): Message | null {
    const row = this.db
      .prepare('SELECT * FROM messages WHERE id = ?')
      .get(messageId) as any;
    if (!row) return null;
    return this.mapRowToMessage(row);
  }

  /**
   * Read messages from a specific chat with limit and before timestamp
   */
  getMessagesByChat(
    chatId: string,
    limit: number = 20,
    beforeTimestamp?: number
  ): Message[] {
    let query = 'SELECT * FROM messages WHERE chat_id = ?';
    const params: any[] = [chatId];

    if (beforeTimestamp) {
      query += ' AND timestamp < ?';
      params.push(beforeTimestamp);
    }

    query += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map((r) => this.mapRowToMessage(r));
  }

  /**
   * Mark message as read
   */
  markAsRead(messageId: string): void {
    this.db
      .prepare('UPDATE messages SET is_read = 1 WHERE id = ?')
      .run(messageId);
  }

  /**
   * Mark all messages in chat as read
   */
  markChatAsRead(chatId: string): void {
    this.db
      .prepare('UPDATE messages SET is_read = 1 WHERE chat_id = ?')
      .run(chatId);
    this.db
      .prepare('UPDATE chats SET unread_count = 0 WHERE chat_id = ?')
      .run(chatId);
  }

  /**
   * Save or update chat metadata
   */
  saveChat(chat: Chat): void {
    const stmt = this.db.prepare(`
      INSERT INTO chats (
        chat_id, name, is_group, unread_count,
        last_message_timestamp, last_message_text
      ) VALUES (
        @chatId, @name, @isGroup, @unreadCount,
        @lastMessageTimestamp, @lastMessageText
      )
      ON CONFLICT(chat_id) DO UPDATE SET
        name = COALESCE(excluded.name, chats.name),
        unread_count = excluded.unread_count,
        last_message_timestamp = COALESCE(excluded.last_message_timestamp, chats.last_message_timestamp),
        last_message_text = COALESCE(excluded.last_message_text, chats.last_message_text)
    `);

    stmt.run({
      chatId: chat.chatId,
      name: chat.name || null,
      isGroup: chat.isGroup ? 1 : 0,
      unreadCount: chat.unreadCount,
      lastMessageTimestamp: chat.lastMessageTimestamp || null,
      lastMessageText: chat.lastMessageText || null,
    });
  }

  /**
   * Get list of chats
   */
  getChats(limit: number = 50, offset: number = 0, isGroup?: boolean): Chat[] {
    let query = 'SELECT * FROM chats';
    const params: any[] = [];

    if (typeof isGroup === 'boolean') {
      query += ' WHERE is_group = ?';
      params.push(isGroup ? 1 : 0);
    }

    query += ' ORDER BY COALESCE(last_message_timestamp, 0) DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map((r) => this.mapRowToChat(r));
  }

  /**
   * Search chats by name or ID
   */
  searchChats(query: string): Chat[] {
    const term = `%${query.toLowerCase()}%`;
    const rows = this.db
      .prepare(
        "SELECT * FROM chats WHERE LOWER(chat_id) LIKE ? OR LOWER(COALESCE(name, '')) LIKE ? ORDER BY last_message_timestamp DESC LIMIT 50"
      )
      .all(term, term) as any[];
    return rows.map((r) => this.mapRowToChat(r));
  }

  /**
   * Save contact
   */
  saveContact(contact: Contact): void {
    const stmt = this.db.prepare(`
      INSERT INTO contacts (jid, name, notify, phone_number)
      VALUES (@jid, @name, @notify, @phoneNumber)
      ON CONFLICT(jid) DO UPDATE SET
        name = COALESCE(excluded.name, contacts.name),
        notify = COALESCE(excluded.notify, contacts.notify),
        phone_number = COALESCE(excluded.phone_number, contacts.phone_number)
    `);

    stmt.run({
      jid: contact.jid,
      name: contact.name || null,
      notify: contact.notify || null,
      phoneNumber: contact.phoneNumber || null,
    });
  }

  /**
   * Get contacts
   */
  getContacts(limit: number = 50, offset: number = 0): Contact[] {
    const rows = this.db
      .prepare('SELECT * FROM contacts ORDER BY COALESCE(name, notify, jid) ASC LIMIT ? OFFSET ?')
      .all(limit, offset) as any[];
    return rows.map((r) => ({
      jid: r.jid,
      name: r.name || undefined,
      notify: r.notify || undefined,
      phoneNumber: r.phone_number || undefined,
    }));
  }

  /**
   * Search contacts
   */
  searchContacts(query: string): Contact[] {
    const term = `%${query.toLowerCase()}%`;
    const rows = this.db
      .prepare(
        `SELECT * FROM contacts
         WHERE LOWER(jid) LIKE ?
            OR LOWER(COALESCE(name, '')) LIKE ?
            OR LOWER(COALESCE(notify, '')) LIKE ?
            OR LOWER(COALESCE(phone_number, '')) LIKE ?
         ORDER BY COALESCE(name, notify, jid) ASC LIMIT 50`
      )
      .all(term, term, term, term) as any[];
    return rows.map((r) => ({
      jid: r.jid,
      name: r.name || undefined,
      notify: r.notify || undefined,
      phoneNumber: r.phone_number || undefined,
    }));
  }

  private updateChatFromMessage(msg: Message): void {
    const unreadInc = !msg.fromMe && !msg.isRead ? 1 : 0;
    this.db
      .prepare(`
        INSERT INTO chats (
          chat_id, name, is_group, unread_count,
          last_message_timestamp, last_message_text
        ) VALUES (
          ?, ?, ?, ?, ?, ?
        )
        ON CONFLICT(chat_id) DO UPDATE SET
          name = COALESCE(excluded.name, chats.name),
          unread_count = chats.unread_count + excluded.unread_count,
          last_message_timestamp = CASE
            WHEN excluded.last_message_timestamp > COALESCE(chats.last_message_timestamp, 0)
            THEN excluded.last_message_timestamp
            ELSE chats.last_message_timestamp
          END,
          last_message_text = CASE
            WHEN excluded.last_message_timestamp >= COALESCE(chats.last_message_timestamp, 0)
            THEN excluded.last_message_text
            ELSE chats.last_message_text
          END
      `)
      .run(
        msg.chatId,
        msg.isGroup ? msg.groupName || null : msg.senderName || null,
        msg.isGroup ? 1 : 0,
        unreadInc,
        msg.timestamp,
        msg.text ? msg.text.slice(0, 200) : `[${msg.messageType}]`
      );
  }

  private mapRowToMessage(row: any): Message {
    const attachment = row.has_attachment
      ? this.attachmentStore.getAttachmentByMessageId(row.id) || undefined
      : undefined;

    return {
      messageId: row.id,
      chatId: row.chat_id,
      sender: row.sender,
      senderName: row.sender_name || undefined,
      recipient: row.recipient,
      fromMe: Boolean(row.from_me),
      timestamp: Number(row.timestamp),
      isoDate: new Date(Number(row.timestamp) * 1000).toISOString(),
      messageType: row.message_type as MessageType,
      text: row.text,
      isGroup: Boolean(row.is_group),
      groupName: row.group_name || undefined,
      quotedMessage: row.quoted_message_id
        ? {
            messageId: row.quoted_message_id,
            sender: row.quoted_sender || undefined,
            text: row.quoted_text || undefined,
          }
        : undefined,
      isRead: Boolean(row.is_read),
      hasAttachment: Boolean(row.has_attachment),
      attachment,
      rawJson: row.raw_json || undefined,
    };
  }

  private mapRowToChat(row: any): Chat {
    return {
      chatId: row.chat_id,
      name: row.name || undefined,
      isGroup: Boolean(row.is_group),
      unreadCount: Number(row.unread_count || 0),
      lastMessageTimestamp: row.last_message_timestamp
        ? Number(row.last_message_timestamp)
        : undefined,
      lastMessageText: row.last_message_text || undefined,
    };
  }
}
