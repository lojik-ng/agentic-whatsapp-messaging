import { Database as DatabaseType } from 'better-sqlite3';
import { ConnectionManager } from '../client/connection.js';
import { EventHandler } from '../client/event-handler.js';
import { MessageStore } from '../storage/message-store.js';
import { AttachmentStore } from '../storage/attachment-store.js';
import { SearchEngine } from '../storage/search-engine.js';
import { MediaDownloader } from '../media/media-downloader.js';
import { MediaSender } from '../media/media-sender.js';
import { createDatabase } from '../storage/database.js';
import { config } from '../config.js';
import {
  ConnectionStatus,
  PairingResult,
  Chat,
  Contact,
  Message,
  MessageSearchFilters,
  SearchResults,
  AttachmentMetadata,
  SendMessageOptions,
  SendAttachmentOptions,
} from '../types.js';

export class WhatsAppSkill {
  private db: DatabaseType;
  private messageStore: MessageStore;
  private attachmentStore: AttachmentStore;
  private searchEngine: SearchEngine;
  private connectionManager: ConnectionManager;
  private mediaDownloader: MediaDownloader;
  private mediaSender: MediaSender;
  private eventHandler: EventHandler;

  constructor(options: {
    db?: DatabaseType;
    dbPath?: string;
    authDir?: string;
    attachmentsDir?: string;
  } = {}) {
    this.db = options.db || createDatabase(options.dbPath || config.dbPath);
    this.attachmentStore = new AttachmentStore(this.db, options.attachmentsDir || config.attachmentsDir);
    this.messageStore = new MessageStore(this.db, this.attachmentStore);
    this.searchEngine = new SearchEngine(this.db);
    this.connectionManager = new ConnectionManager(options.authDir || config.authDir);

    this.mediaDownloader = new MediaDownloader(
      this.attachmentStore,
      () => this.connectionManager.getSocket()
    );
    this.mediaSender = new MediaSender(() => this.connectionManager.getSocket());
    this.eventHandler = new EventHandler(
      this.messageStore,
      this.attachmentStore,
      this.mediaDownloader
    );

    // Forward events
    this.connectionManager.on('connection.update', (update) => {
      const sock = this.connectionManager.getSocket();
      if (sock && update.connection === 'open') {
        this.eventHandler.bindSocket(sock);
      }
    });
  }

  // -------------------------------------------------------------
  // 1. Connection & Pairing Code Operations
  // -------------------------------------------------------------

  /**
   * Connect to WhatsApp using pairing code flow (NO QR codes)
   */
  async connectWhatsApp(phoneNumber: string): Promise<PairingResult> {
    const result = await this.connectionManager.connectWithPairingCode(phoneNumber);
    const sock = this.connectionManager.getSocket();
    if (sock) {
      this.eventHandler.bindSocket(sock);
    }
    return result;
  }

  /**
   * Resume existing session or initialize connection
   */
  async init(): Promise<void> {
    const sock = await this.connectionManager.initSocket();
    this.eventHandler.bindSocket(sock);
  }

  /**
   * Get connection state, active user info, or active pairing code
   */
  async getConnectionStatus(): Promise<ConnectionStatus> {
    return this.connectionManager.getStatus();
  }

  /**
   * Get active pairing code if currently pairing
   */
  async getPairingCode(): Promise<PairingResult | null> {
    const status = this.connectionManager.getStatus();
    if (!status.pairingCode) return null;

    const formatted = this.connectionManager.formatPairingCode(status.pairingCode);
    return {
      pairingCode: status.pairingCode,
      formattedCode: formatted,
      phoneNumber: status.user?.phone || '',
      instructions: [
        '1. Open WhatsApp on your phone.',
        '2. Tap Settings > Linked Devices > Link a Device.',
        '3. Select "Link with phone number instead".',
        `4. Enter the code: ${formatted}.`,
      ],
    };
  }

  /**
   * Disconnect WhatsApp session
   */
  async disconnectWhatsApp(): Promise<void> {
    await this.connectionManager.disconnect();
  }

  // -------------------------------------------------------------
  // 2. Chat & Contact Operations
  // -------------------------------------------------------------

  /**
   * Get list of chats sorted by most recent message
   */
  async getChats(options: { limit?: number; offset?: number; isGroup?: boolean } = {}): Promise<Chat[]> {
    return this.messageStore.getChats(options.limit ?? 50, options.offset ?? 0, options.isGroup);
  }

  /**
   * Search chats by name or JID
   */
  async searchChats(query: string): Promise<Chat[]> {
    return this.messageStore.searchChats(query);
  }

  /**
   * Get contacts list
   */
  async getContacts(options: { limit?: number; offset?: number } = {}): Promise<Contact[]> {
    return this.messageStore.getContacts(options.limit ?? 50, options.offset ?? 0);
  }

  /**
   * Search contacts by name, notify, phone number, or JID
   */
  async searchContacts(query: string): Promise<Contact[]> {
    return this.messageStore.searchContacts(query);
  }

  // -------------------------------------------------------------
  // 3. Message Reading & Search Operations
  // -------------------------------------------------------------

  /**
   * Read recent messages from a specific chat
   */
  async readMessages(
    chatId: string,
    options: { limit?: number; before?: number | string } = {}
  ): Promise<Message[]> {
    let beforeTs: number | undefined;
    if (options.before) {
      beforeTs = typeof options.before === 'number'
        ? (options.before > 1e11 ? Math.floor(options.before / 1000) : options.before)
        : Math.floor(new Date(options.before).getTime() / 1000);
    }

    return this.messageStore.getMessagesByChat(chatId, options.limit ?? 20, beforeTs);
  }

  /**
   * Search message history using rich filters + FTS5 full-text search
   */
  async searchMessages(filters: MessageSearchFilters = {}): Promise<SearchResults> {
    return this.searchEngine.searchMessages(filters);
  }

  /**
   * Get a single message by ID
   */
  async getMessage(messageId: string): Promise<Message | null> {
    return this.messageStore.getMessage(messageId);
  }

  // -------------------------------------------------------------
  // 4. Message Sending & Replying
  // -------------------------------------------------------------

  /**
   * Send a text message to a contact or group
   */
  async sendMessage(to: string, text: string, options: SendMessageOptions = {}): Promise<Message> {
    const sock = this.connectionManager.getSocket();
    if (!sock) {
      throw new Error('WhatsApp is not connected. Use connectWhatsApp(phoneNumber) first.');
    }

    const jid = this.mediaSender.normalizeJid(to);

    // Prepare quoting if requested
    let quotedWAMsg: any = undefined;
    if (options.quotedMessageId) {
      const quoted = this.messageStore.getMessage(options.quotedMessageId);
      if (quoted?.rawJson) {
        try {
          quotedWAMsg = JSON.parse(quoted.rawJson);
        } catch {
          // Ignore parse errors
        }
      }
    }

    const sent = await sock.sendMessage(
      jid,
      { text },
      quotedWAMsg ? { quoted: quotedWAMsg } : undefined
    );

    if (!sent || !sent.key?.id) {
      throw new Error('Failed to send message: empty response from WhatsApp socket');
    }

    // Process and persist sent message
    const msg = await this.eventHandler.handleIncomingMessage(sent, sock);
    return msg || this.messageStore.getMessage(sent.key.id)!;
  }

  /**
   * Reply to a specific message with text
   */
  async replyToMessage(messageId: string, text: string): Promise<Message> {
    const target = this.messageStore.getMessage(messageId);
    if (!target) {
      throw new Error(`Cannot reply: message with ID "${messageId}" was not found.`);
    }

    return this.sendMessage(target.chatId, text, { quotedMessageId: messageId });
  }

  // -------------------------------------------------------------
  // 5. Attachments & Media Operations
  // -------------------------------------------------------------

  /**
   * Download and store an attachment for a message
   */
  async downloadAttachment(messageId: string): Promise<AttachmentMetadata> {
    const targetMsg = this.messageStore.getMessage(messageId);
    if (!targetMsg) {
      throw new Error(`Message "${messageId}" not found.`);
    }

    if (!targetMsg.hasAttachment) {
      throw new Error(`Message "${messageId}" does not contain any media attachment.`);
    }

    const attachment = targetMsg.attachment || this.attachmentStore.getAttachmentByMessageId(messageId);
    if (!attachment) {
      throw new Error(`No attachment record found for message "${messageId}".`);
    }

    if (!targetMsg.rawJson) {
      throw new Error(`Raw message payload missing for message "${messageId}"; unable to decrypt media.`);
    }

    const rawWAMessage = JSON.parse(targetMsg.rawJson);
    const downloaded = await this.mediaDownloader.download(attachment, rawWAMessage);

    // Refresh message in memory/store
    targetMsg.attachment = downloaded;
    return downloaded;
  }

  /**
   * Send an attachment (file path or Buffer) to a recipient or group
   */
  async sendAttachment(
    to: string,
    file: string | Buffer,
    caption?: string,
    options: SendAttachmentOptions = {}
  ): Promise<Message> {
    const sock = this.connectionManager.getSocket();
    if (!sock) {
      throw new Error('WhatsApp is not connected. Use connectWhatsApp(phoneNumber) first.');
    }

    const jid = this.mediaSender.normalizeJid(to);

    const { content, mediaType, filename, mimeType, buffer } =
      await this.mediaSender.buildMediaPayload(file, { ...options, caption });

    // Prepare quoted context if requested
    let quotedWAMsg: any = undefined;
    if (options.quotedMessageId) {
      const quoted = this.messageStore.getMessage(options.quotedMessageId);
      if (quoted?.rawJson) {
        try {
          quotedWAMsg = JSON.parse(quoted.rawJson);
        } catch {
          // Ignore
        }
      }
    }

    const sent = await sock.sendMessage(
      jid,
      content,
      quotedWAMsg ? { quoted: quotedWAMsg } : undefined
    );

    if (!sent || !sent.key?.id) {
      throw new Error('Failed to send attachment: empty response from WhatsApp socket');
    }

    // Process sent message
    const msg = await this.eventHandler.handleIncomingMessage(sent, sock);

    // Also persist local file reference in attachment store for outgoing attachment
    if (msg && msg.attachment) {
      const savedAttachment = this.attachmentStore.saveDownloadedFile(
        msg.attachment.id,
        buffer,
        msg.chatId,
        msg.messageId,
        filename
      );
      msg.attachment = savedAttachment;
    }

    return msg || this.messageStore.getMessage(sent.key.id)!;
  }

  /**
   * Reply to a message with an attachment
   */
  async replyWithAttachment(
    messageId: string,
    file: string | Buffer,
    caption?: string,
    options: SendAttachmentOptions = {}
  ): Promise<Message> {
    const target = this.messageStore.getMessage(messageId);
    if (!target) {
      throw new Error(`Cannot reply: message with ID "${messageId}" was not found.`);
    }

    return this.sendAttachment(target.chatId, file, caption, {
      ...options,
      quotedMessageId: messageId,
    });
  }

  // -------------------------------------------------------------
  // Event Emitter access
  // -------------------------------------------------------------

  /**
   * Listen to incoming messages, connection changes, and downloads
   */
  onMessage(listener: (message: Message) => void): this {
    this.eventHandler.on('message', listener);
    return this;
  }

  onConnectionChange(listener: (change: { previous: string; current: string }) => void): this {
    this.connectionManager.on('state.change', listener);
    return this;
  }

  onAttachmentDownloaded(listener: (data: { messageId: string; attachment: AttachmentMetadata }) => void): this {
    this.eventHandler.on('attachment.downloaded', listener);
    return this;
  }
}
