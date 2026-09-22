---
name: whatsapp
description: Reusable WhatsApp Web skill for AI Agents powered by Baileys. Connect via WhatsApp pairing code (no QR codes), search message history via local SQLite FTS5 index, send and reply to messages, and download/send attachments of all types (PDFs, images, audio, voice notes, videos, documents).
metadata:
  type: tool-integration
  domain: messaging / whatsapp
  transport: cli-and-http
---

# WhatsApp Web Skill for AI Agents

Production-ready WhatsApp Web integration built on `@whiskeysockets/baileys` designed specifically for autonomous AI Agents.

Key Capabilities:
- **Pairing-Code Authentication**: No QR codes required. Request an 8-character pairing code with your phone number and enter it in WhatsApp's linked-device settings.
- **Local SQLite & FTS5 Index**: All incoming/outgoing messages, chats, contacts, and attachments are locally indexed for fast multi-filter search.
- **First-Class Media & Attachments**: Download, decrypt, store, and send images, documents, PDFs, audio, voice notes, stickers, and videos.
- **Quoted Messages & Replies**: Reply directly to any message with text or attachments.
- **Agent Interfaces**: Run via CLI commands, REST HTTP API daemon, or programmatic Node.js tools.

---

## 1. Authentication & Pairing Flow

> [!IMPORTANT]
> This skill does **NOT** use QR codes. It uses **WhatsApp Pairing Code Authentication**.

### To Connect a WhatsApp Account:

1. Request a pairing code with your international phone number:
   ```bash
   whatsapp-skill connect "+15551234567"
   ```
   Or via HTTP:
   ```bash
   curl -X POST http://127.0.0.1:3333/connect \
     -H "Content-Type: application/json" \
     -d '{"phoneNumber": "+15551234567"}'
   ```

2. The skill returns an 8-character pairing code (e.g. `ABCD-1234`):
   - Open **WhatsApp** on your mobile phone.
   - Go to **Settings** (iOS) or **Menu / 3 dots** (Android) > **Linked Devices**.
   - Tap **Link a Device**.
   - Tap **"Link with phone number instead"** at the bottom of the screen.
   - Enter the pairing code.

3. The skill automatically detects authentication, saves the session credentials to `./data/auth`, and reconnects automatically across restarts.

### Connection States
- `Disconnected`: Socket closed.
- `Connecting`: Establishing WebSocket connection to WhatsApp.
- `Waiting for pairing` / `Pairing`: Pairing code requested, awaiting user entry on phone.
- `Connected`: Authenticated and ready for messaging.
- `Logged out`: Session was invalidated or logged out on the phone; requires new pairing.

Check status at any time:
```bash
whatsapp-skill status
```

---

## 2. Quick CLI Reference for AI Agents

### Search Messages
```bash
# Keyword search with FTS5:
whatsapp-skill search --query "payment receipt"

# Messages from a specific sender within a date range:
whatsapp-skill search --sender-name "John" --since "2026-09-01" --until "2026-09-15"

# Show messages with documents or PDFs received this month:
whatsapp-skill search --has-attachment --attachment-type "document" --since "this month"

# Show unread messages in groups:
whatsapp-skill search --groups --unread
```

### Send Messages & Replies
```bash
# Send text message:
whatsapp-skill send --to "+15551234567" --text "Hello! Here is the update."

# Reply to a message:
whatsapp-skill reply --message-id "3EB0ABC123" --text "Received, thank you!"
```

### Send & Download Attachments
```bash
# Send a PDF document:
whatsapp-skill send-attachment --to "+15551234567" --file "/path/to/invoice.pdf" --caption "Monthly Invoice"

# Reply to a message with an image:
whatsapp-skill reply-attachment --message-id "3EB0ABC123" --file "/path/to/chart.png" --caption "Requested chart"

# Download an incoming attachment:
whatsapp-skill download "3EB0ABC123"
```

### Chats & Contacts
```bash
# List recent chats:
whatsapp-skill chats --limit 20

# Search chats by contact or group name:
whatsapp-skill search-chats "School"

# List contacts:
whatsapp-skill contacts --limit 50
```

---

## 3. HTTP REST API Reference

Start the background daemon:
```bash
whatsapp-skill serve --port 3333
# Or npm run serve
```

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/status` | Get connection status & user info |
| `POST` | `/connect` | Body: `{"phoneNumber": "..."}` - Start pairing |
| `GET` | `/pairing-code` | Get active pairing code |
| `POST` | `/disconnect` | Disconnect connection |
| `GET` | `/chats?limit=50&isGroup=true` | List chats |
| `GET` | `/chats/search?query=name` | Search chats |
| `GET` | `/contacts` | List contacts |
| `GET` | `/messages?chatId=...&limit=20` | Read chat messages |
| `POST` | `/messages/search` | Body: `{"query":"...", "since":"...", ...}` |
| `GET` | `/messages/:id` | Get message details |
| `POST` | `/messages/send` | Body: `{"to":"...", "text":"...", "quotedMessageId":"..."}` |
| `POST` | `/messages/reply` | Body: `{"messageId":"...", "text":"..."}` |
| `POST` | `/messages/send-attachment` | Body: `{"to":"...", "file":"...", "caption":"..."}` |
| `POST` | `/messages/reply-attachment` | Body: `{"messageId":"...", "file":"...", "caption":"..."}` |
| `GET` | `/messages/:id/download` | Download attachment (`?raw=true` to stream file) |

---

## 4. AI Tool Function Definitions

The skill exposes 16 agent-friendly tools adhering to OpenAI, Gemini, and Anthropic tool calling specifications:
- `connectWhatsApp(phoneNumber)`
- `getConnectionStatus()`
- `getPairingCode()`
- `disconnectWhatsApp()`
- `getChats(limit, offset, isGroup)`
- `searchChats(query)`
- `getContacts(limit, offset)`
- `searchContacts(query)`
- `readMessages(chatId, limit, before)`
- `searchMessages(filters)`
- `getMessage(messageId)`
- `sendMessage(to, text, quotedMessageId)`
- `replyToMessage(messageId, text)`
- `downloadAttachment(messageId)`
- `sendAttachment(to, file, caption, mediaType, fileName, quotedMessageId)`
- `replyWithAttachment(messageId, file, caption, mediaType, fileName)`

Full schema definitions are available in [`tools.json`](file:///home/lojik/Documents/GitHub/whatsapp-skill/tools.json).

---

## 5. Storage & Privacy Architecture

- **Auth Session**: Stored in `./data/auth` with `0700` filesystem permissions. Private keys and auth credentials are never exposed via agent interfaces.
- **SQLite Database**: Stored in `./data/whatsapp.db` with WAL mode and SQLite FTS5 virtual tables.
- **Media Attachments**: Stored in `./data/attachments/<chatId>/<messageId>_<filename>`.
