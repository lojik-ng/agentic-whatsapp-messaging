/**
 * WhatsApp Skill Types & Interfaces
 */

export type ConnectionState =
  | 'Disconnected'
  | 'Connecting'
  | 'Waiting for pairing'
  | 'Pairing'
  | 'Connected'
  | 'Logged out';

export interface ConnectionStatus {
  state: ConnectionState;
  user?: {
    id: string;
    name?: string;
    phone?: string;
  };
  pairingCode?: string;
  instructions?: string;
  lastError?: string;
  connectedAt?: string;
}

export type MessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'voice'
  | 'document'
  | 'sticker'
  | 'contact'
  | 'location'
  | 'other';

export type MediaType =
  | 'image'
  | 'video'
  | 'audio'
  | 'voice'
  | 'document'
  | 'sticker';

export type DownloadStatus = 'pending' | 'completed' | 'failed';

export interface AttachmentMetadata {
  id: string;
  messageId: string;
  chatId: string;
  mediaType: MediaType;
  filename: string;
  mimeType: string;
  fileSize: number;
  caption?: string;
  localPath?: string;
  downloadStatus: DownloadStatus;
  downloadedAt?: string;
  checksum?: string;
  errorMessage?: string;
}

export interface QuotedMessageInfo {
  messageId: string;
  sender?: string;
  text?: string;
  mediaType?: MediaType;
}

export interface Message {
  messageId: string;
  chatId: string;
  sender: string;
  senderName?: string;
  recipient: string;
  fromMe: boolean;
  timestamp: number; // Unix epoch seconds
  isoDate: string;
  messageType: MessageType;
  text: string;
  isGroup: boolean;
  groupName?: string;
  quotedMessage?: QuotedMessageInfo;
  isRead: boolean;
  hasAttachment: boolean;
  attachment?: AttachmentMetadata;
  rawJson?: string;
}

export interface Chat {
  chatId: string;
  name?: string;
  isGroup: boolean;
  unreadCount: number;
  lastMessageTimestamp?: number;
  lastMessageText?: string;
}

export interface Contact {
  jid: string;
  name?: string;
  notify?: string;
  phoneNumber?: string;
}

export interface MessageSearchFilters {
  // Text matching
  query?: string; // FTS5 or keyword
  exactPhrase?: string; // Exact match phrase

  // Sender & Recipient filters
  sender?: string;
  senderName?: string;
  phoneNumber?: string;
  recipient?: string;

  // Chat filters
  chat?: string;
  isGroup?: boolean;

  // Date / Time filters (ISO date string, epoch seconds, or relative like 'today', 'yesterday')
  since?: string | number; // Greater than or equal (after)
  until?: string | number; // Less than or equal (before)

  // Message attributes
  messageId?: string;
  messageType?: MessageType;
  isRead?: boolean;
  quotedMessageId?: string;

  // Attachment filters
  hasAttachment?: boolean;
  attachmentType?: MediaType;

  // Pagination & Sorting
  limit?: number; // default 20
  offset?: number; // default 0
  sort?: 'asc' | 'desc'; // default 'desc' (most recent first)
}

export interface SearchResults {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  messages: Message[];
}

export interface SendMessageOptions {
  quotedMessageId?: string;
}

export interface SendAttachmentOptions {
  caption?: string;
  fileName?: string;
  mimeType?: string;
  mediaType?: MediaType;
  quotedMessageId?: string;
  isVoiceNote?: boolean; // When mediaType is 'audio'
}

export interface PairingResult {
  pairingCode: string;
  formattedCode: string;
  phoneNumber: string;
  instructions: string[];
  expiresInSeconds?: number;
}
