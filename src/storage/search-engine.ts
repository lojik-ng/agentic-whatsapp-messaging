import { Database as DatabaseType } from 'better-sqlite3';
import {
  Message,
  MessageSearchFilters,
  SearchResults,
  MessageType,
  MediaType,
  DownloadStatus,
} from '../types.js';

export class SearchEngine {
  constructor(private db: DatabaseType) {}

  /**
   * Search messages using complex multi-criteria filters + FTS5 full text search
   */
  searchMessages(filters: MessageSearchFilters = {}): SearchResults {
    const limit = Math.max(1, Math.min(filters.limit ?? 20, 200));
    const offset = Math.max(0, filters.offset ?? 0);
    const sort = filters.sort === 'asc' ? 'ASC' : 'DESC';

    const conditions: string[] = [];
    const params: any[] = [];

    // 1. Text Search: FTS5 or Exact phrase
    const hasFtsQuery = Boolean(filters.query && filters.query.trim());
    const hasExactPhrase = Boolean(filters.exactPhrase && filters.exactPhrase.trim());

    if (hasExactPhrase) {
      conditions.push('LOWER(m.text) LIKE ?');
      params.push(`%${filters.exactPhrase!.trim().toLowerCase()}%`);
    } else if (hasFtsQuery) {
      const sanitizedFts = this.sanitizeFtsQuery(filters.query!.trim());
      if (sanitizedFts) {
        conditions.push(`m.id IN (
          SELECT message_id FROM messages_fts
          WHERE messages_fts MATCH ?
        )`);
        params.push(sanitizedFts);
      }
    }

    // 2. Message ID filter
    if (filters.messageId) {
      conditions.push('m.id = ?');
      params.push(filters.messageId);
    }

    // 3. Sender filter (JID or partial)
    if (filters.sender) {
      conditions.push('(m.sender = ? OR m.sender LIKE ?)');
      params.push(filters.sender, `%${filters.sender}%`);
    }

    // 4. Sender name filter
    if (filters.senderName) {
      conditions.push("LOWER(COALESCE(m.sender_name, '')) LIKE ?");
      params.push(`%${filters.senderName.toLowerCase()}%`);
    }

    // 5. Phone number filter
    if (filters.phoneNumber) {
      const cleanPhone = filters.phoneNumber.replace(/\D/g, '');
      if (cleanPhone) {
        conditions.push('(m.sender LIKE ? OR m.recipient LIKE ?)');
        params.push(`%${cleanPhone}%`, `%${cleanPhone}%`);
      }
    }

    // 6. Recipient filter
    if (filters.recipient) {
      conditions.push('(m.recipient = ? OR m.recipient LIKE ?)');
      params.push(filters.recipient, `%${filters.recipient}%`);
    }

    // 7. Chat filter (JID or Chat Name)
    if (filters.chat) {
      conditions.push(`(
        m.chat_id = ?
        OR m.chat_id LIKE ?
        OR LOWER(COALESCE(m.group_name, '')) LIKE ?
        OR m.chat_id IN (
          SELECT chat_id FROM chats WHERE LOWER(COALESCE(name, '')) LIKE ?
        )
      )`);
      const term = `%${filters.chat.toLowerCase()}%`;
      params.push(filters.chat, `%${filters.chat}%`, term, term);
    }

    // 8. Group vs Private filter
    if (typeof filters.isGroup === 'boolean') {
      conditions.push('m.is_group = ?');
      params.push(filters.isGroup ? 1 : 0);
    }

    // 9. Date / Time range filters
    if (filters.since !== undefined) {
      const sinceTs = this.parseDateFilter(filters.since, 'start');
      if (sinceTs !== null) {
        conditions.push('m.timestamp >= ?');
        params.push(sinceTs);
      }
    }

    if (filters.until !== undefined) {
      const untilTs = this.parseDateFilter(filters.until, 'end');
      if (untilTs !== null) {
        conditions.push('m.timestamp <= ?');
        params.push(untilTs);
      }
    }

    // 10. Message Type filter
    if (filters.messageType) {
      conditions.push('m.message_type = ?');
      params.push(filters.messageType);
    }

    // 11. Read / Unread filter
    if (typeof filters.isRead === 'boolean') {
      conditions.push('m.is_read = ?');
      params.push(filters.isRead ? 1 : 0);
    }

    // 12. Attachment filters
    if (typeof filters.hasAttachment === 'boolean') {
      conditions.push('m.has_attachment = ?');
      params.push(filters.hasAttachment ? 1 : 0);
    }

    if (filters.attachmentType) {
      conditions.push(`m.id IN (
        SELECT message_id FROM attachments WHERE media_type = ?
      )`);
      params.push(filters.attachmentType);
    }

    // 13. Quoted Message filter
    if (filters.quotedMessageId) {
      conditions.push('m.quoted_message_id = ?');
      params.push(filters.quotedMessageId);
    }

    // Construct WHERE clause
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count total matches
    const countSql = `SELECT COUNT(*) as total FROM messages m ${whereClause}`;
    const totalRow = this.db.prepare(countSql).get(...params) as any;
    const total = Number(totalRow?.total || 0);

    // Fetch paginated records with joined attachment
    const querySql = `
      SELECT
        m.*,
        a.id as att_id,
        a.media_type as att_media_type,
        a.filename as att_filename,
        a.mime_type as att_mime_type,
        a.file_size as att_file_size,
        a.caption as att_caption,
        a.local_path as att_local_path,
        a.download_status as att_download_status,
        a.downloaded_at as att_downloaded_at,
        a.checksum as att_checksum,
        a.error_message as att_error_message
      FROM messages m
      LEFT JOIN attachments a ON a.message_id = m.id
      ${whereClause}
      ORDER BY m.timestamp ${sort}
      LIMIT ? OFFSET ?
    `;

    const queryParams = [...params, limit, offset];
    const rows = this.db.prepare(querySql).all(...queryParams) as any[];

    const messages = rows.map((r) => this.mapJoinedRowToMessage(r));

    return {
      total,
      limit,
      offset,
      hasMore: offset + messages.length < total,
      messages,
    };
  }

  /**
   * Parse various date representations (ISO string, epoch seconds, human terms)
   */
  private parseDateFilter(
    val: string | number,
    boundary: 'start' | 'end'
  ): number | null {
    if (typeof val === 'number') {
      // If in milliseconds, convert to seconds
      return val > 1e11 ? Math.floor(val / 1000) : val;
    }

    const trimmed = val.trim().toLowerCase();
    const now = new Date();

    if (trimmed === 'today') {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      if (boundary === 'end') {
        d.setHours(23, 59, 59, 999);
      }
      return Math.floor(d.getTime() / 1000);
    }

    if (trimmed === 'yesterday') {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      if (boundary === 'end') {
        d.setHours(23, 59, 59, 999);
      }
      return Math.floor(d.getTime() / 1000);
    }

    if (trimmed === 'this week') {
      const day = now.getDay();
      const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday
      const d = new Date(now.setDate(diff));
      d.setHours(0, 0, 0, 0);
      if (boundary === 'end') {
        d.setDate(d.getDate() + 6);
        d.setHours(23, 59, 59, 999);
      }
      return Math.floor(d.getTime() / 1000);
    }

    if (trimmed === 'this month') {
      const d = new Date(now.getFullYear(), now.getMonth(), 1);
      if (boundary === 'end') {
        d.setMonth(d.getMonth() + 1);
        d.setDate(0);
        d.setHours(23, 59, 59, 999);
      }
      return Math.floor(d.getTime() / 1000);
    }

    // Try parsing as standard date string
    const parsed = Date.parse(val);
    if (!isNaN(parsed)) {
      const d = new Date(parsed);
      // If only date string like '2026-09-15', handle end boundary
      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed) && boundary === 'end') {
        d.setHours(23, 59, 59, 999);
      }
      return Math.floor(d.getTime() / 1000);
    }

    return null;
  }

  /**
   * Sanitize user input for SQLite FTS5 query
   */
  private sanitizeFtsQuery(query: string): string {
    // If user already quoted the phrase, respect it
    if (query.startsWith('"') && query.endsWith('"')) {
      return query;
    }

    // Split words, strip FTS special chars (*, ^, :, etc.) and format for token prefix matching
    const words = query
      .replace(/["*^:{}()[\]~]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 0);

    if (words.length === 0) return '';
    // Format words as prefix matches e.g. "pay*"
    return words.map((w) => `"${w}"*`).join(' ');
  }

  private mapJoinedRowToMessage(row: any): Message {
    const attachment = row.has_attachment && row.att_id
      ? {
          id: row.att_id,
          messageId: row.id,
          chatId: row.chat_id,
          mediaType: row.att_media_type as MediaType,
          filename: row.att_filename,
          mimeType: row.att_mime_type,
          fileSize: Number(row.att_file_size || 0),
          caption: row.att_caption || undefined,
          localPath: row.att_local_path || undefined,
          downloadStatus: row.att_download_status as DownloadStatus,
          downloadedAt: row.att_downloaded_at || undefined,
          checksum: row.att_checksum || undefined,
          errorMessage: row.att_error_message || undefined,
        }
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
}
