import path from 'path';
import mime from 'mime-types';
import { MediaType } from '../types.js';

/**
 * Categorize mime type or extension into a WhatsApp MediaType
 */
export function determineMediaType(
  mimeTypeOrPath: string,
  isVoiceNote: boolean = false
): MediaType {
  let mimeType: string = mimeTypeOrPath;

  if (mimeTypeOrPath.includes('/') && !mimeTypeOrPath.startsWith('application/') && !mimeTypeOrPath.startsWith('image/') && !mimeTypeOrPath.startsWith('video/') && !mimeTypeOrPath.startsWith('audio/')) {
    // Looks like a file path
    const ext = path.extname(mimeTypeOrPath);
    mimeType = mime.lookup(ext) || 'application/octet-stream';
  } else if (!mimeTypeOrPath.includes('/')) {
    // Looks like an extension (e.g. 'pdf', 'jpg')
    mimeType = mime.lookup(mimeTypeOrPath) || 'application/octet-stream';
  }

  if (mimeType === 'image/webp') {
    return 'sticker';
  }

  if (mimeType.startsWith('image/')) {
    return 'image';
  }

  if (mimeType.startsWith('video/')) {
    return 'video';
  }

  if (mimeType.startsWith('audio/')) {
    return isVoiceNote ? 'voice' : 'audio';
  }

  return 'document';
}

/**
 * Lookup MIME type from filename or path with fallback
 */
export function getMimeType(filePathOrName: string, defaultMime: string = 'application/octet-stream'): string {
  return mime.lookup(filePathOrName) || defaultMime;
}

/**
 * Get standard file extension from MIME type
 */
export function getExtensionFromMime(mimeType: string): string {
  return mime.extension(mimeType) || 'bin';
}

/**
 * Sanitize filename to prevent directory traversal or invalid characters
 */
export function sanitizeFilename(name: string): string {
  return path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_');
}
