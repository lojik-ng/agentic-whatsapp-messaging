import { EventEmitter } from 'events';
import { WAMessage } from '@whiskeysockets/baileys';

/**
 * Creates a realistic mock WASocket for unit and integration testing
 */
export function createMockWASocket(options: {
  registered?: boolean;
  userId?: string;
  pairingCode?: string;
} = {}) {
  const ev = new EventEmitter();
  let registered = options.registered ?? false;
  const userId = options.userId || '15551234567:1@s.whatsapp.net';
  const pairingCode = options.pairingCode || 'ABCDEFGH';

  const mockSocket = {
    authState: {
      creds: {
        registered,
        me: { id: userId, name: 'Test Bot' },
      },
    },
    user: { id: userId, name: 'Test Bot' },
    ev: {
      on: (event: string, listener: (...args: any[]) => void) => ev.on(event, listener),
      emit: (event: string, ...args: any[]) => ev.emit(event, ...args),
      removeAllListeners: () => ev.removeAllListeners(),
    },
    requestPairingCode: async (phoneNumber: string) => {
      if (!phoneNumber) throw new Error('Phone number is required');
      return pairingCode;
    },
    sendMessage: async (jid: string, content: any, sendOptions?: any) => {
      const messageId = 'MOCK_' + Math.random().toString(36).substring(2, 11).toUpperCase();
      const rawWAMessage: WAMessage = {
        key: {
          remoteJid: jid,
          fromMe: true,
          id: messageId,
        },
        messageTimestamp: Math.floor(Date.now() / 1000),
        message: {},
      };

      if (content.text) {
        rawWAMessage.message = { conversation: content.text };
      } else if (content.image) {
        rawWAMessage.message = {
          imageMessage: {
            caption: content.caption,
            mimetype: content.mimetype || 'image/jpeg',
            fileLength: Buffer.isBuffer(content.image) ? content.image.length : 1024,
          },
        };
      } else if (content.document) {
        rawWAMessage.message = {
          documentMessage: {
            caption: content.caption,
            fileName: content.fileName || 'document.pdf',
            mimetype: content.mimetype || 'application/pdf',
            fileLength: Buffer.isBuffer(content.document) ? content.document.length : 2048,
          },
        };
      } else if (content.audio) {
        rawWAMessage.message = {
          audioMessage: {
            mimetype: content.mimetype || 'audio/ogg',
            ptt: Boolean(content.ptt),
            fileLength: Buffer.isBuffer(content.audio) ? content.audio.length : 4096,
          },
        };
      }

      if (sendOptions?.quoted) {
        const contextInfo = {
          stanzaId: sendOptions.quoted.key?.id,
          participant: sendOptions.quoted.key?.participant || sendOptions.quoted.key?.remoteJid,
          quotedMessage: sendOptions.quoted.message,
        };

        if (content.text) {
          rawWAMessage.message = {
            extendedTextMessage: {
              text: content.text,
              contextInfo,
            },
          };
        } else {
          const type = Object.keys(rawWAMessage.message || {})[0];
          if (type && typeof (rawWAMessage.message as any)[type] === 'object') {
            (rawWAMessage.message as any)[type].contextInfo = contextInfo;
          }
        }
      }

      return rawWAMessage;
    },
    updateMediaMessage: async (msg: any) => msg,
    end: () => {
      ev.emit('connection.update', { connection: 'close' });
    },
  };

  return { mockSocket, ev };
}
