import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

// Load environment variables from .env if present
dotenv.config();

export interface AppConfig {
  authDir: string;
  attachmentsDir: string;
  dbPath: string;
  autoDownloadMedia: boolean;
  maxAutoDownloadSizeMb: number;
  serverPort: number;
  serverHost: string;
  apiKey?: string;
  logLevel: string;
}

const rootDir = process.cwd();

export const config: AppConfig = {
  authDir: path.resolve(rootDir, process.env.WHATSAPP_AUTH_DIR || './data/auth'),
  attachmentsDir: path.resolve(rootDir, process.env.WHATSAPP_ATTACHMENTS_DIR || './data/attachments'),
  dbPath: path.resolve(rootDir, process.env.WHATSAPP_DB_PATH || './data/whatsapp.db'),
  autoDownloadMedia: process.env.AUTO_DOWNLOAD_MEDIA !== 'false',
  maxAutoDownloadSizeMb: parseInt(process.env.MAX_AUTO_DOWNLOAD_SIZE_MB || '50', 10),
  serverPort: parseInt(process.env.PORT || '3333', 10),
  serverHost: process.env.HOST || '127.0.0.1',
  apiKey: process.env.WHATSAPP_API_KEY || undefined,
  logLevel: process.env.LOG_LEVEL || 'info',
};

/**
 * Ensure storage directories exist with secure permissions
 */
export function ensureDirectories(): void {
  // Ensure auth directory (restricted 0700 for privacy/credentials security)
  if (!fs.existsSync(config.authDir)) {
    fs.mkdirSync(config.authDir, { recursive: true, mode: 0o700 });
  }

  // Ensure attachments directory
  if (!fs.existsSync(config.attachmentsDir)) {
    fs.mkdirSync(config.attachmentsDir, { recursive: true });
  }

  // Ensure database directory
  const dbDir = path.dirname(config.dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
}
