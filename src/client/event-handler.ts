import { WAMessage, getContentType, WASocket } from '@whiskeysockets/baileys';
import { EventEmitter } from 'events';
import { MessageStore } from '../storage/message-store.js';
import { AttachmentStore } from '../storage/attachment-store.js';
import { MediaDownloader } from '../media/media-downloader.js';
import {
  Message,
  AttachmentMetadata,
  MessageType,
  MediaType,
  QuotedMessageInfo,
} from '../types.js';
import { determineMediaType, sanitizeFilename, getExtensionFromMime } from '../media/mime-utils.js';

export class EventHandler extends EventEmitter {
  constructor(
    private messageStore: MessageStore,
    private attachmentStore: AttachmentStore,
    private mediaDownloader: MediaDownloader
  ) {
    super();
  }

  /**
   * Bind event handlers to a Baileys WASocket
   */
  bindSocket(sock: WASocket): void {
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      for (const rawMsg of messages) {
        try {
          await this.handleIncomingMessage(rawMsg, sock);
        } catch (err) {
          // Log error but continue processing subsequent messages
        }
      }
    });

    sock.ev.on('messages.update', (updates) => {
      for (const update of updates) {
        if (update.update?.status) {
          // Read receipt or delivery update
          if (update.update.status >= 3) {
            // Read status
            this.messageStore.markAsRead(update.key.id!);
          }
        }
      }
    });

    sock.ev.on('chats.update', (updates) => {
      for (const chat of updates) {
        if (chat.id) {
          this.messageStore.saveChat({
            chatId: chat.id,
            unreadCount: chat.unreadCount || 0,
            isGroup: chat.id.endsWith('@g.us'),
          });
        }
      }
    });

    sock.ev.on('contacts.upsert', (contacts) => {
      for (const contact of contacts) {
        if (contact.id) {
          this.messageStore.saveContact({
            jid: contact.id,
            name: contact.name || undefined,
            notify: contact.notify || undefined,
            phoneNumber: contact.id.split('@')[0],
          });
        }
      }
    });
  }

  /**
   * Parse a raw WAMessage and persist to storage
   */
  async handleIncomingMessage(rawMsg: WAMessage, sock?: WASocket): Promise<Message | null> {
    if (!rawMsg.message || !rawMsg.key?.id || !rawMsg.key?.remoteJid) {
      return null;
    }

    const messageId = rawMsg.key.id;
    const chatId = rawMsg.key.remoteJid;
    const isGroup = chatId.endsWith('@g.us');
    const fromMe = Boolean(rawMsg.key.fromMe);

    // Sender JID
    const myJid = sock?.user?.id || 'me';
    const sender = isGroup
      ? (rawMsg.key.participant || (fromMe ? myJid : chatId))
      : (fromMe ? myJid : chatId);

    // Recipient JID
    const recipient = fromMe ? chatId : myJid;

    // Sender Name
    const senderName = rawMsg.pushName || undefined;

    // Timestamp
    const tsRaw = rawMsg.messageTimestamp;
    const timestamp = typeof tsRaw === 'number'
      ? tsRaw
      : (tsRaw ? Number(tsRaw) : Math.floor(Date.now() / 1000));

    // Unwrap message if view-once or ephemeral
    const msgContent = this.unwrapMessage(rawMsg.message);
    const contentType = getContentType(msgContent);

    let messageType: MessageType = 'text';
    let textContent = '';
    let attachmentMeta: AttachmentMetadata | undefined;
    let quotedInfo: QuotedMessageInfo | undefined;

    // Extract quoted context info if present
    const contextInfo = this.extractContextInfo(msgContent, contentType);
    if (contextInfo?.stanzaId) {
      quotedInfo = {
        messageId: contextInfo.stanzaId,
        sender: contextInfo.participant,
        text: this.extractQuotedText(contextInfo.quotedMessage),
      };
    }

    // Process specific message types
    if (contentType === 'conversation') {
      messageType = 'text';
      textContent = msgContent.conversation || '';
    } else if (contentType === 'extendedTextMessage') {
      messageType = 'text';
      textContent = msgContent.extendedTextMessage?.text || '';
    } else if (contentType === 'imageMessage') {
      messageType = 'image';
      const img = msgContent.imageMessage;
      textContent = img?.caption || '';
      attachmentMeta = this.createAttachmentMeta(
        messageId,
        chatId,
        'image',
        img?.mimetype || 'image/jpeg',
        Number(img?.fileLength || 0),
        img?.caption || undefined
      );
    } else if (contentType === 'videoMessage') {
      messageType = 'video';
      const vid = msgContent.videoMessage;
      textContent = vid?.caption || '';
      attachmentMeta = this.createAttachmentMeta(
        messageId,
        chatId,
        'video',
        vid?.mimetype || 'video/mp4',
        Number(vid?.fileLength || 0),
        vid?.caption || undefined
      );
    } else if (contentType === 'audioMessage') {
      const aud = msgContent.audioMessage;
      const isVoice = Boolean(aud?.ptt);
      messageType = isVoice ? 'voice' : 'audio';
      attachmentMeta = this.createAttachmentMeta(
        messageId,
        chatId,
        isVoice ? 'voice' : 'audio',
        aud?.mimetype || (isVoice ? 'audio/ogg; codecs=opus' : 'audio/mp4'),
        Number(aud?.fileLength || 0)
      );
    } else if (contentType === 'documentMessage' || contentType === 'documentWithCaptionMessage') {
      messageType = 'document';
      const doc = contentType === 'documentWithCaptionMessage'
        ? msgContent.documentWithCaptionMessage?.message?.documentMessage
        : msgContent.documentMessage;
      textContent = doc?.caption || '';
      const docMime = doc?.mimetype || 'application/octet-stream';
      const defaultExt = getExtensionFromMime(docMime);
      const docName = doc?.fileName || `document_${messageId}.${defaultExt}`;
      attachmentMeta = this.createAttachmentMeta(
        messageId,
        chatId,
        'document',
        docMime,
        Number(doc?.fileLength || 0),
        doc?.caption || undefined,
        docName
      );
    } else if (contentType === 'stickerMessage') {
      messageType = 'sticker';
      const stk = msgContent.stickerMessage;
      attachmentMeta = this.createAttachmentMeta(
        messageId,
        chatId,
        'sticker',
        stk?.mimetype || 'image/webp',
        Number(stk?.fileLength || 0),
        undefined,
        `sticker_${messageId}.webp`
      );
    } else if (contentType === 'contactMessage') {
      messageType = 'contact';
      textContent = msgContent.contactMessage?.vcard || msgContent.contactMessage?.displayName || '';
    } else if (contentType === 'locationMessage') {
      messageType = 'location';
      const loc = msgContent.locationMessage;
      textContent = `Location: ${loc?.degreesLatitude}, ${loc?.degreesLongitude}${loc?.name ? ' - ' + loc.name : ''}`;
    } else {
      messageType = 'other';
      textContent = `[${contentType || 'unknown'}]`;
    }

    const message: Message = {
      messageId,
      chatId,
      sender,
      senderName,
      recipient,
      fromMe,
      timestamp,
      isoDate: new Date(timestamp * 1000).toISOString(),
      messageType,
      text: textContent,
      isGroup,
      quotedMessage: quotedInfo,
      isRead: fromMe ? true : false,
      hasAttachment: Boolean(attachmentMeta),
      attachment: attachmentMeta,
      rawJson: JSON.stringify(rawMsg),
    };

    // Persist into database
    this.messageStore.saveMessage(message, rawMsg);

    // Auto-download media asynchronously if eligible
    if (attachmentMeta && this.mediaDownloader.isEligibleForAutoDownload(attachmentMeta.fileSize)) {
      this.mediaDownloader
        .download(attachmentMeta, rawMsg)
        .then((updatedAttachment) => {
          message.attachment = updatedAttachment;
          this.emit('attachment.downloaded', { messageId, attachment: updatedAttachment });
        })
        .catch(() => {
          // Failure recorded in attachment store
        });
    }

    // Emit parsed message event for agent / consumers
    this.emit('message', message);

    return message;
  }

  private unwrapMessage(msg: any): any {
    if (!msg) return {};
    if (msg.ephemeralMessage) return this.unwrapMessage(msg.ephemeralMessage.message);
    if (msg.viewOnceMessage) return this.unwrapMessage(msg.viewOnceMessage.message);
    if (msg.viewOnceMessageV2) return this.unwrapMessage(msg.viewOnceMessageV2.message);
    if (msg.documentWithCaptionMessage) return msg;
    return msg;
  }

  private extractContextInfo(msgContent: any, contentType?: string): any {
    if (!contentType || !msgContent) return null;
    return msgContent[contentType]?.contextInfo || null;
  }

  private extractQuotedText(quotedMsg: any): string | undefined {
    if (!quotedMsg) return undefined;
    const unwrapped = this.unwrapMessage(quotedMsg);
    const type = getContentType(unwrapped);
    if (type === 'conversation') return unwrapped.conversation;
    if (type === 'extendedTextMessage') return unwrapped.extendedTextMessage?.text;
    if (type === 'imageMessage') return unwrapped.imageMessage?.caption || '[Image]';
    if (type === 'videoMessage') return unwrapped.videoMessage?.caption || '[Video]';
    if (type === 'documentMessage') return unwrapped.documentMessage?.caption || unwrapped.documentMessage?.fileName || '[Document]';
    return type ? `[${type}]` : undefined;
  }

  private createAttachmentMeta(
    messageId: string,
    chatId: string,
    mediaType: MediaType,
    mimeType: string,
    fileSize: number,
    caption?: string,
    customFilename?: string
  ): AttachmentMetadata {
    const ext = getExtensionFromMime(mimeType);
    const filename = sanitizeFilename(customFilename || `${mediaType}_${messageId}.${ext}`);

    return {
      id: `${messageId}_att`,
      messageId,
      chatId,
      mediaType,
      filename,
      mimeType,
      fileSize,
      caption,
      downloadStatus: 'pending',
    };
  }
}
