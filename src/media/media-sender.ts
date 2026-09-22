import fs from 'fs';
import path from 'path';
import { SendAttachmentOptions, MediaType } from '../types.js';
import { determineMediaType, getMimeType, sanitizeFilename } from './mime-utils.js';

export class MediaSender {
  constructor(private getSocket: () => any) {}

  /**
   * Build Baileys message payload for media attachment
   */
  async buildMediaPayload(
    file: string | Buffer,
    options: SendAttachmentOptions = {}
  ): Promise<{ content: any; mediaType: MediaType; filename: string; mimeType: string; buffer: Buffer }> {
    let buffer: Buffer;
    let originalName: string = options.fileName || 'file';

    if (typeof file === 'string') {
      // file is a file path
      if (!fs.existsSync(file)) {
        throw new Error(`File does not exist at path: ${file}`);
      }
      buffer = fs.readFileSync(file);
      if (!options.fileName) {
        originalName = path.basename(file);
      }
    } else if (Buffer.isBuffer(file)) {
      buffer = file;
    } else {
      throw new Error('Invalid file argument: must be a local file path or a Buffer');
    }

    const filename = sanitizeFilename(originalName);
    const mimeType = options.mimeType || getMimeType(filename);
    const mediaType = options.mediaType || determineMediaType(mimeType, options.isVoiceNote);

    let content: any;

    switch (mediaType) {
      case 'image':
        content = {
          image: buffer,
          caption: options.caption || undefined,
          mimetype: mimeType,
        };
        break;

      case 'video':
        content = {
          video: buffer,
          caption: options.caption || undefined,
          mimetype: mimeType,
        };
        break;

      case 'voice':
        content = {
          audio: buffer,
          mimetype: mimeType.startsWith('audio/') ? mimeType : 'audio/ogg; codecs=opus',
          ptt: true,
        };
        break;

      case 'audio':
        content = {
          audio: buffer,
          mimetype: mimeType,
          ptt: false,
        };
        break;

      case 'sticker':
        content = {
          sticker: buffer,
          mimetype: 'image/webp',
        };
        break;

      case 'document':
      default:
        content = {
          document: buffer,
          mimetype: mimeType,
          fileName: filename,
          caption: options.caption || undefined,
        };
        break;
    }

    return { content, mediaType, filename, mimeType, buffer };
  }

  /**
   * Normalize any input phone number or JID to standard WhatsApp JID
   */
  normalizeJid(to: string): string {
    const trimmed = to.trim();
    if (trimmed.endsWith('@s.whatsapp.net') || trimmed.endsWith('@g.us')) {
      return trimmed;
    }
    // Remove +, spaces, hyphens, parentheses
    const digitsOnly = trimmed.replace(/\D/g, '');
    if (!digitsOnly) {
      throw new Error(`Invalid phone number or recipient: "${to}"`);
    }
    return `${digitsOnly}@s.whatsapp.net`;
  }
}
