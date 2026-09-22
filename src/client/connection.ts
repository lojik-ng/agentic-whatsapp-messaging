import makeWASocket, {
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  WASocket,
  Browsers,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import fs from 'fs';
import { EventEmitter } from 'events';
import { config, ensureDirectories } from '../config.js';
import { ConnectionState, ConnectionStatus, PairingResult } from '../types.js';

export class ConnectionManager extends EventEmitter {
  private socket: WASocket | null = null;
  private state: ConnectionState = 'Disconnected';
  private pairingCode: string | null = null;
  private formattedCode: string | null = null;
  private currentPhoneNumber: string | null = null;
  private isIntentionalDisconnect: boolean = false;
  private reconnectAttempts: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private logger = pino({ level: config.logLevel === 'silent' ? 'silent' : 'warn' });
  private connectedAt: string | null = null;
  private lastError: string | null = null;

  constructor(private authDir: string = config.authDir) {
    super();
    ensureDirectories();
  }

  /**
   * Get current connection status object
   */
  getStatus(): ConnectionStatus {
    const user = this.socket?.user
      ? {
          id: this.socket.user.id,
          name: this.socket.user.name || undefined,
          phone: this.socket.user.id ? this.socket.user.id.split(':')[0].split('@')[0] : undefined,
        }
      : undefined;

    return {
      state: this.state,
      user,
      pairingCode: this.pairingCode || undefined,
      instructions: this.getInstructions(),
      lastError: this.lastError || undefined,
      connectedAt: this.connectedAt || undefined,
    };
  }

  /**
   * Get active WASocket
   */
  getSocket(): WASocket | null {
    return this.socket;
  }

  /**
   * Clean and normalize a phone number (must be digits only with country code)
   */
  sanitizePhoneNumber(phoneNumber: string): string {
    const cleaned = phoneNumber.replace(/\D/g, '');
    if (!cleaned || cleaned.length < 7 || cleaned.length > 15) {
      throw new Error(
        `Invalid phone number "${phoneNumber}". Please provide international format with country code (e.g. 15551234567).`
      );
    }
    return cleaned;
  }

  /**
   * Format an 8-character pairing code into XXXX-XXXX for clear readability
   */
  formatPairingCode(code: string): string {
    const clean = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    if (clean.length === 8) {
      return `${clean.slice(0, 4)}-${clean.slice(4)}`;
    }
    return clean;
  }

  /**
   * Start connection and request pairing code for a phone number
   */
  async connectWithPairingCode(phoneNumber: string): Promise<PairingResult> {
    const cleanPhone = this.sanitizePhoneNumber(phoneNumber);
    this.currentPhoneNumber = cleanPhone;
    this.isIntentionalDisconnect = false;

    // Initialize socket
    await this.initSocket();

    // Check if already registered
    if (this.socket?.authState?.creds?.registered) {
      this.setState('Connected');
      return {
        pairingCode: '',
        formattedCode: '',
        phoneNumber: cleanPhone,
        instructions: ['Already authenticated and connected.'],
      };
    }

    this.setState('Waiting for pairing');

    // Wait a brief moment for socket handshakes before requesting pairing code
    await new Promise((resolve) => setTimeout(resolve, 1500));

    try {
      this.setState('Pairing');
      const rawCode = await this.socket!.requestPairingCode(cleanPhone);
      this.pairingCode = rawCode;
      this.formattedCode = this.formatPairingCode(rawCode);

      const instructions = [
        '1. Open WhatsApp on your phone.',
        '2. Tap Settings (iOS) or Menu / 3 dots (Android) > Linked Devices.',
        '3. Tap "Link a Device".',
        '4. Select "Link with phone number instead" at the bottom of the screen.',
        `5. Enter the pairing code: ${this.formattedCode} (or ${this.pairingCode}).`,
      ];

      return {
        pairingCode: this.pairingCode,
        formattedCode: this.formattedCode,
        phoneNumber: cleanPhone,
        instructions,
        expiresInSeconds: 120,
      };
    } catch (err: any) {
      this.lastError = err?.message || String(err);
      this.setState('Disconnected');
      throw new Error(`Failed to request WhatsApp pairing code: ${this.lastError}`);
    }
  }

  /**
   * Start or resume existing connection (e.g. on application start)
   */
  async initSocket(): Promise<WASocket> {
    if (this.socket && (this.state === 'Connected' || this.state === 'Connecting')) {
      return this.socket;
    }

    this.setState('Connecting');
    this.lastError = null;

    const { state: authState, saveCreds } = await useMultiFileAuthState(this.authDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: authState,
      printQRInTerminal: false, // NO QR code authentication
      logger: this.logger as any,
      browser: Browsers.ubuntu('Chrome'),
      syncFullHistory: false,
      markOnlineOnConnect: true,
      generateHighQualityLinkPreview: true,
    });

    this.socket = sock;

    // Save credentials whenever updated
    sock.ev.on('creds.update', saveCreds);

    // Connection state updates
    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === 'connecting') {
        if (this.state !== 'Pairing' && this.state !== 'Waiting for pairing') {
          this.setState('Connecting');
        }
      } else if (connection === 'open') {
        this.reconnectAttempts = 0;
        this.connectedAt = new Date().toISOString();
        this.pairingCode = null;
        this.formattedCode = null;
        this.setState('Connected');
      } else if (connection === 'close') {
        const error = lastDisconnect?.error as Boom | undefined;
        const statusCode = error?.output?.statusCode;
        const shouldReconnect =
          !this.isIntentionalDisconnect &&
          statusCode !== DisconnectReason.loggedOut;

        if (statusCode === DisconnectReason.loggedOut) {
          this.lastError = 'Session logged out or invalidated by WhatsApp';
          this.setState('Logged out');
          // Clear credentials folder so a clean new pairing can occur
          this.clearAuthSession();
        } else {
          this.setState('Disconnected');
          if (shouldReconnect) {
            this.scheduleReconnect();
          }
        }
      }

      this.emit('connection.update', update);
    });

    return sock;
  }

  /**
   * Disconnect intentionally
   */
  async disconnect(): Promise<void> {
    this.isIntentionalDisconnect = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket) {
      try {
        this.socket.end(undefined);
      } catch {
        // Ignore socket end errors
      }
      this.socket = null;
    }

    this.setState('Disconnected');
  }

  /**
   * Clear saved authentication session
   */
  clearAuthSession(): void {
    try {
      if (fs.existsSync(this.authDir)) {
        fs.rmSync(this.authDir, { recursive: true, force: true });
        fs.mkdirSync(this.authDir, { recursive: true, mode: 0o700 });
      }
    } catch (err) {
      this.logger.error({ err }, 'Failed to clear auth session directory');
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

    this.logger.info(`Scheduling WhatsApp reconnect in ${delay}ms (attempt #${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.initSocket();
      } catch (err) {
        this.scheduleReconnect();
      }
    }, delay);
  }

  private setState(newState: ConnectionState): void {
    if (this.state !== newState) {
      const prev = this.state;
      this.state = newState;
      this.emit('state.change', { previous: prev, current: newState });
    }
  }

  private getInstructions(): string | undefined {
    if (this.state === 'Pairing' || this.state === 'Waiting for pairing') {
      return `Enter code ${this.formattedCode || this.pairingCode} in WhatsApp > Linked Devices > Link with phone number instead.`;
    }
    if (this.state === 'Logged out') {
      return 'Session logged out. Use connectWhatsApp(phoneNumber) to pair a new device.';
    }
    if (this.state === 'Disconnected') {
      return 'Disconnected. Run connectWhatsApp(phoneNumber) to connect.';
    }
    return undefined;
  }
}
