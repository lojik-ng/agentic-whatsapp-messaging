import { Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { AttachmentMetadata, MediaType, DownloadStatus } from '../types.js';
import { config } from '../config.js';

export class AttachmentStore {
  constructor(
    private db: DatabaseType,
    private attachmentsDir: string = config.attachmentsDir
  ) {
    if (!fs.existsSync(this.attachmentsDir)) {
      fs.mkdirSync(this.attachmentsDir, { recursive: true });
    }
  }

  /**
   * Save or update attachment metadata in database
   */
  saveAttachment(attachment: AttachmentMetadata): void {
    const stmt = this.db.prepare(`
      INSERT INTO attachments (
        id, message_id, chat_id, media_type, filename, mime_type,
        file_size, caption, local_path, download_status, downloaded_at,
        checksum, error_message
      ) VALUES (
        @id, @messageId, @chatId, @mediaType, @filename, @mimeType,
        @fileSize, @caption, @localPath, @downloadStatus, @downloadedAt,
        @checksum, @errorMessage
      )
      ON CONFLICT(id) DO UPDATE SET
        filename = excluded.filename,
        mime_type = excluded.mime_type,
        file_size = excluded.file_size,
        caption = excluded.caption,
        local_path = excluded.local_path,
        download_status = excluded.download_status,
        downloaded_at = excluded.downloaded_at,
        checksum = excluded.checksum,
        error_message = excluded.error_message
    `);

    stmt.run({
      id: attachment.id,
      messageId: attachment.messageId,
      chatId: attachment.chatId,
      mediaType: attachment.mediaType,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      fileSize: attachment.fileSize,
      caption: attachment.caption || null,
      localPath: attachment.localPath || null,
      downloadStatus: attachment.downloadStatus,
      downloadedAt: attachment.downloadedAt || null,
      checksum: attachment.checksum || null,
      errorMessage: attachment.errorMessage || null,
    });
  }

  /**
   * Get attachment by its ID
   */
  getAttachmentById(id: string): AttachmentMetadata | null {
    const row = this.db
      .prepare('SELECT * FROM attachments WHERE id = ?')
      .get(id) as any;
    if (!row) return null;
    return this.mapRowToAttachment(row);
  }

  /**
   * Get attachment associated with a message
   */
  getAttachmentByMessageId(messageId: string): AttachmentMetadata | null {
    const row = this.db
      .prepare('SELECT * FROM attachments WHERE message_id = ?')
      .get(messageId) as any;
    if (!row) return null;
    return this.mapRowToAttachment(row);
  }

  /**
   * Generate an absolute target path on disk for an attachment
   */
  resolveFilePath(chatId: string, messageId: string, filename: string): string {
    // Sanitize chatId and filename for file system safety
    const safeChatId = chatId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeFilename = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    const chatDir = path.join(this.attachmentsDir, safeChatId);

    if (!fs.existsSync(chatDir)) {
      fs.mkdirSync(chatDir, { recursive: true });
    }

    return path.join(chatDir, `${messageId}_${safeFilename}`);
  }

  /**
   * Store downloaded buffer to disk, compute SHA-256 checksum, and update DB
   */
  saveDownloadedFile(
    attachmentId: string,
    buffer: Buffer,
    chatId: string,
    messageId: string,
    filename: string
  ): AttachmentMetadata {
    const targetPath = this.resolveFilePath(chatId, messageId, filename);
    fs.writeFileSync(targetPath, buffer);

    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
    const fileSize = buffer.length;
    const downloadedAt = new Date().toISOString();

    const stmt = this.db.prepare(`
      UPDATE attachments
      SET local_path = ?,
          file_size = ?,
          checksum = ?,
          download_status = 'completed',
          downloaded_at = ?,
          error_message = NULL
      WHERE id = ?
    `);

    stmt.run(targetPath, fileSize, checksum, downloadedAt, attachmentId);

    const updated = this.getAttachmentById(attachmentId);
    if (!updated) {
      throw new Error(`Failed to retrieve updated attachment ${attachmentId}`);
    }
    return updated;
  }

  /**
   * Record download failure
   */
  recordDownloadFailure(attachmentId: string, errorMessage: string): void {
    const stmt = this.db.prepare(`
      UPDATE attachments
      SET download_status = 'failed',
          error_message = ?
      WHERE id = ?
    `);
    stmt.run(errorMessage, attachmentId);
  }

  private mapRowToAttachment(row: any): AttachmentMetadata {
    return {
      id: row.id,
      messageId: row.message_id,
      chatId: row.chat_id,
      mediaType: row.media_type as MediaType,
      filename: row.filename,
      mimeType: row.mime_type,
      fileSize: Number(row.file_size || 0),
      caption: row.caption || undefined,
      localPath: row.local_path || undefined,
      downloadStatus: row.download_status as DownloadStatus,
      downloadedAt: row.downloaded_at || undefined,
      checksum: row.checksum || undefined,
      errorMessage: row.error_message || undefined,
    };
  }
}
