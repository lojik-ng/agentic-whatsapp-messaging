import { downloadMediaMessage, WAMessage } from '@whiskeysockets/baileys';
import fs from 'fs';
import pino from 'pino';
import { AttachmentStore } from '../storage/attachment-store.js';
import { AttachmentMetadata } from '../types.js';
import { config } from '../config.js';

export class MediaDownloader {
  private fallbackLogger = pino({ level: 'silent' });

  constructor(
    private attachmentStore: AttachmentStore,
    private getSocket: () => any
  ) {}

  /**
   * Download and persist media attachment for a given message
   */
  async download(
    attachment: AttachmentMetadata,
    rawMessage: WAMessage
  ): Promise<AttachmentMetadata> {
    // 1. Check if already downloaded and file exists on disk
    if (
      attachment.localPath &&
      fs.existsSync(attachment.localPath) &&
      attachment.downloadStatus === 'completed'
    ) {
      return attachment;
    }

    const sock = this.getSocket();
    if (!sock) {
      const err = 'WhatsApp socket not connected; cannot download media';
      this.attachmentStore.recordDownloadFailure(attachment.id, err);
      throw new Error(err);
    }

    try {
      // 2. Download media buffer using Baileys downloadMediaMessage
      const buffer = (await downloadMediaMessage(
        rawMessage,
        'buffer',
        {},
        {
          logger: (sock.logger || this.fallbackLogger) as any,
          reuploadRequest: sock.updateMediaMessage
            ? sock.updateMediaMessage.bind(sock)
            : undefined,
        }
      )) as Buffer;

      if (!buffer || buffer.length === 0) {
        throw new Error('Received empty buffer for media download');
      }

      // 3. Save buffer to disk and update database record
      const updated = this.attachmentStore.saveDownloadedFile(
        attachment.id,
        buffer,
        attachment.chatId,
        attachment.messageId,
        attachment.filename
      );

      return updated;
    } catch (err: any) {
      const errMsg = err?.message || String(err);
      this.attachmentStore.recordDownloadFailure(attachment.id, errMsg);
      throw new Error(`Failed to download attachment ${attachment.id}: ${errMsg}`);
    }
  }

  /**
   * Check if an attachment is eligible for automatic download based on size limits
   */
  isEligibleForAutoDownload(fileSize: number): boolean {
    if (!config.autoDownloadMedia) return false;
    const maxBytes = config.maxAutoDownloadSizeMb * 1024 * 1024;
    return fileSize <= maxBytes;
  }
}
