---
name: whatsapp-messaging
description: Reusable WhatsApp Messaging skill for AI Agents, search message history, send and reply to messages, and download/send attachments of all types (PDFs, images, audio, voice notes, videos, documents).
metadata:
  type: tool-integration
  domain: messaging / whatsapp
  transport: cli-and-http
---

# WhatsApp Messaging Skill for AI Agents

Production-ready WhatsApp Web integration built on `@whiskeysockets/baileys` designed specifically for autonomous AI Agents.

Key Capabilities:
- **Pairing-Code Authentication**: No QR codes required. Request an 8-character pairing code with your phone number and enter it in WhatsApp's linked-device settings.
- **Local SQLite & FTS5 Index**: All incoming/outgoing messages, chats, contacts, and attachments are locally indexed for fast multi-filter search.
- **First-Class Media & Attachments**: Download, decrypt, store, and send images, documents, PDFs, audio, voice notes, stickers, and videos.
- **Quoted Messages & Replies**: Reply directly to any message with text or attachments.
- **Agent Interfaces**: Run via CLI commands, REST HTTP API daemon, or programmatic Node.js tools.

---
## 0. Install & Connect (agent checklist)

```bash
# From the git repository:
git clone https://github.com/lojik-ng/agentic-whatsapp-messaging
cd agentic-whatsapp-messaging
npm install
npm run build
# every command below: node bin/whatsapp-messaging-skill.js <command>
```
(The global CLI `whatsapp-messaging-skill` is the same thing, installable with `npm i -g whatsapp-messaging-skill` once the package is published.)

**Connect** (the agent does 1, 2 and 4; the human does 3):
1. Start the daemon in the background — it is the socket owner and auto-resumes saved sessions:
   ```bash
   node bin/whatsapp-messaging-skill.js serve
   ```
2. Request a pairing code:
   ```bash
   curl -X POST http://127.0.0.1:3333/connect \
     -H "Content-Type: application/json" \
     -d '{"phoneNumber": "+15551234567"}'
   ```
3. Give the human the 8-character code from the response (`formattedCode`).
   Phone: Settings (iOS) / Menu ⋮ (Android) → Linked Devices → Link a Device → **"Link with phone number instead"** → enter code.
4. Poll `curl http://127.0.0.1:3333/status` until `"state": "Connected"`.

> **One socket owner.** While the daemon runs, one-shot CLI commands fail with `Connection Closed` — route sends/searches through the HTTP API instead.

---

## 1. Authentication & Pairing Flow

> [!IMPORTANT]
> This skill does **NOT** use QR codes. It uses **WhatsApp Pairing Code Authentication**.

### To Connect a WhatsApp Account:

1. Request a pairing code with your international phone number:
   ```bash
   whatsapp-messaging-skill connect "+15551234567"
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
whatsapp-messaging-skill status
```

---

## 2. Quick CLI Reference for AI Agents

### Search Messages
```bash
# Keyword search with FTS5:
whatsapp-messaging-skill search --query "payment receipt"

# Messages from a specific sender within a date range:
whatsapp-messaging-skill search --sender-name "John" --since "2026-09-01" --until "2026-09-15"

# Show messages with documents or PDFs received this month:
whatsapp-messaging-skill search --has-attachment --attachment-type "document" --since "this month"

# Show unread messages in groups:
whatsapp-messaging-skill search --groups --unread
```

### Send Messages & Replies
```bash
# Send text message:
whatsapp-messaging-skill send --to "+15551234567" --text "Hello! Here is the update."

# Reply to a message:
whatsapp-messaging-skill reply --message-id "3EB0ABC123" --text "Received, thank you!"
```

### Send & Download Attachments
```bash
# Send a PDF document:
whatsapp-messaging-skill send-attachment --to "+15551234567" --file "/path/to/invoice.pdf" --caption "Monthly Invoice"

# Reply to a message with an image:
whatsapp-messaging-skill reply-attachment --message-id "3EB0ABC123" --file "/path/to/chart.png" --caption "Requested chart"

# Download an incoming attachment:
whatsapp-messaging-skill download "3EB0ABC123"
```

### Chats & Contacts
```bash
# List recent chats:
whatsapp-messaging-skill chats --limit 20

# Search chats by contact or group name:
whatsapp-messaging-skill search-chats "School"

# List contacts:
whatsapp-messaging-skill contacts --limit 50
```

---

## 3. HTTP REST API Reference

Start the background daemon:
```bash
whatsapp-messaging-skill serve --port 3333
# Or npm run serve
```

 > [!WARNING]
 > **One active socket per device.** WhatsApp allows only a single live connection per device session. While the `serve` daemon (or a `connect` receiver) is running, one-shot CLI commands that open their own socket (`send`, `chats`, `search`, …) will fail with `Connection Closed` / `Precondition Required`.
 > Pick **one** socket owner: either run the `serve` daemon and route sends/queries through its HTTP endpoints (e.g. `POST /messages/send`), **or** use one-shot CLI commands with no persistent daemon running.

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

Full schema definitions are available in [`tools.json`](./tools.json).

---

## 5. Storage & Privacy Architecture

- **Auth Session**: Stored in `./data/auth` with `0700` filesystem permissions. Private keys and auth credentials are never exposed via agent interfaces.
- **SQLite Database**: Stored in `./data/whatsapp.db` with WAL mode and SQLite FTS5 virtual tables.
- **Media Attachments**: Stored in `./data/attachments/<chatId>/<messageId>_<filename>`.
