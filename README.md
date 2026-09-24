# WhatsApp Messaging Skill for AI Agents

A reusable, production-grade **WhatsApp Web skill for AI Agents** built on top of [WhiskeySockets/Baileys](https://github.com/WhiskeySockets/Baileys).

The skill provides **WhatsApp pairing code authentication** (no QR codes required), local high-speed message indexing via **SQLite & FTS5 full-text search**, complete **attachment and media management** (images, videos, audio, voice notes, PDFs, spreadsheets, and documents), and clean interfaces for AI Agents via CLI, REST API, or programmatic tool calls.

---

** 🤖 Paste the following instruction in your AI Agent** 

`Install this skill in your global skills folder, request the user's WhatsApp phone number, and connect it: https://github.com/lojik-ng/agentic-whatsapp-messaging`


---

## Architecture Overview

```mermaid
flowchart TD
    subgraph Agent["AI Agent Layer"]
        CLI["CLI Tool (whatsapp-messaging-skill)"]
        HTTP["REST API Server (:3333)"]
        SDK["Node.js SDK (WhatsAppSkill)"]
        Tools["AI Tools (tools.json)"]
    end

    subgraph Skill["WhatsApp Skill Core"]
        Ops["Operations Facade (WhatsAppSkill)"]
        Conn["Connection Manager (Pairing Code & State)"]
        Evt["Event Handler (Ingestion & Normalization)"]
        Downloader["Media Downloader & Decryptor"]
        Sender["Media Sender & Payload Builder"]
    end

    subgraph BaileysLayer["WhatsApp Network (Baileys)"]
        Socket["makeWASocket (WebSocket)"]
        Auth["Multi-File Auth Credentials (./data/auth)"]
    end

    subgraph StorageLayer["Local Storage Layer"]
        DB[(SQLite Database ./data/whatsapp.db)]
        FTS5[(FTS5 Full-Text Search Virtual Table)]
        Files[("Attachments Store ./data/attachments")]
    end

    Agent --> Ops
    Ops --> Conn
    Ops --> Evt
    Ops --> Downloader
    Ops --> Sender
    Conn --> Socket
    Socket --> Auth
    Socket --> Evt
    Evt --> DB
    Evt --> FTS5
    Evt --> Downloader
    Downloader --> Files
    Sender --> Socket
    Ops --> DB
```

---

## Key Features

1. **WhatsApp Pairing Code Authentication (No QR Codes)**:
   - Authenticate completely headless by requesting an 8-character pairing code using the user's phone number.
   - Enter the code on the mobile device via *Settings > Linked Devices > Link with phone number instead*.
   - Automatically detects authentication and securely persists session credentials.
   - Restores session automatically across restarts.

2. **Local Searchable Message Index (SQLite + FTS5)**:
   - Incoming and outgoing messages are stored in a local SQLite database with Write-Ahead Logging (WAL).
   - FTS5 virtual tables and automatic database triggers enable instant keyword search across message bodies, image/video captions, and document filenames.
   - Rich filtering: sender, sender name, phone number, recipient, chat, group/private, date range, message type, read status, and media attachments.

3. **Complete Attachment & Media Support**:
   - First-class support for **Images, Videos, Audio, Voice notes (PTT), Documents (PDFs, spreadsheets, presentations, text files), Stickers, Contacts, and Locations**.
   - Decrypts and downloads attachments using Baileys decryptor and caches locally to avoid redundant re-downloads.
   - SHA-256 checksum verification and file size tracking.
   - Natural sending and replying with attachments.

4. **Agent-Friendly Operations & Tools**:
   - 16 standardized operations exposed as CLI commands, REST HTTP API endpoints, and OpenAI/Gemini/Anthropic tool schemas ([`tools.json`](./tools.json)).

---

## For AI Agents

If you are an AI agent that can use this skill, follow these instructions:

**Install this skill in your global skills folder** (e.g. `~/.claude/skills/` or your harness's equivalent), then **request the user's WhatsApp phone number** (international format, e.g. `+2348012345678`) and connect it:

```bash
# 1. Install into your global skills folder
SKILL_DIR="$HOME/.claude/skills/whatsapp-messaging"   # or your harness's global skills path
git clone https://github.com/lojik-ng/agentic-whatsapp-messaging "$SKILL_DIR"
cd "$SKILL_DIR"
npm install
npm run build

# 2. Ask the user for their WhatsApp phone number (with country code), e.g. +2348012345678

# 3. Connect — start the daemon, request the pairing code, hand it to the user
node bin/whatsapp-messaging-skill.js serve &   # background; it auto-resumes saved sessions
curl -s -X POST http://127.0.0.1:3333/connect \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber": "<their phone number>"}'
# give the 8-character code to the user; they enter it on their phone
# poll until connected:
curl -s http://127.0.0.1:3333/status
```

Then use the CLI commands (`node "$SKILL_DIR/bin/whatsapp-messaging-skill.js <command>`) or the REST endpoints below to chat, search, and send/receive media.

---

## Connecting WhatsApp via Pairing Code

The agent drives pairing through the persistent **daemon** — one-shot CLI commands
exit after printing the code and can't watch the pairing finish. Only step 3 needs a human.

1. **Agent** starts the daemon in the background (it also resumes any saved session
   from `./data/auth` automatically):
   ```bash
   node bin/whatsapp-messaging-skill.js serve   # listens on http://127.0.0.1:3333
   ```
2. **Agent** requests a pairing code with the user's international phone number and
   hands the 8-character code to the user:
   ```bash
   curl -s -X POST http://127.0.0.1:3333/connect \
     -H "Content-Type: application/json" \
     -d '{"phoneNumber": "+15551234567"}'
   ```
3. **Human** enters the code on their phone:
   ```text
   WhatsApp on phone:
   1. Open WhatsApp.
   2. Settings (iOS) or Menu ⋮ (Android) → Linked Devices.
   3. "Link a Device" → "Link with phone number instead".
   4. Enter the pairing code (e.g. ABCD-1234).
   ```
4. **Agent** polls until the daemon reports `Connected`:
   ```bash
   curl -s http://127.0.0.1:3333/status
   ```
   Credentials persist in `./data/auth`; later restarts reconnect automatically, no re-pairing.

---

## CLI Usage

The skill provides an executable CLI. From the cloned directory run
`node bin/whatsapp-messaging-skill.js <command>` (or `npx tsx bin/whatsapp-messaging-skill.js <command>` without building):

```bash
# Check status
node bin/whatsapp-messaging-skill.js status

# List recent conversations
node bin/whatsapp-messaging-skill.js chats --limit 20

# Search conversations
node bin/whatsapp-messaging-skill.js search-chats "School"

# Search messages with FTS5 keyword
node bin/whatsapp-messaging-skill.js search --query "invoice"

# Search messages from specific sender within date range
node bin/whatsapp-messaging-skill.js search --sender-name "John" --since "2026-09-01" --until "2026-09-15"

# Show messages with documents received this month
node bin/whatsapp-messaging-skill.js search --has-attachment --attachment-type "document" --since "this month"

# Send a text message
node bin/whatsapp-messaging-skill.js send --to "+15551234567" --text "Hello from AI Agent!"

# Reply to a message
node bin/whatsapp-messaging-skill.js reply --message-id "3EB012345" --text "I have processed your request."

# Send an attachment (PDF, image, etc.)
node bin/whatsapp-messaging-skill.js send-attachment --to "+15551234567" --file "./docs/agenda.pdf" --caption "Meeting Agenda"

# Reply with an attachment
node bin/whatsapp-messaging-skill.js reply-attachment --message-id "3EB012345" --file "./chart.png" --caption "Here is the chart"

# Download an attachment
node bin/whatsapp-messaging-skill.js download "3EB012345"
```

---

## REST API Server

Run the HTTP server:
```bash
npm run serve
# Server listening on http://127.0.0.1:3333
```

 > [!WARNING]
 > **One active socket per device.** WhatsApp allows only a single live connection per device session. While the `serve` daemon (or a `connect` receiver) is running, one-shot CLI commands that open their own socket (`send`, `chats`, `search`, …) will fail with `Connection Closed` / `Precondition Required`.
 > Pick **one** socket owner: either run the `serve` daemon and route sends/queries through its HTTP endpoints (e.g. `POST /messages/send`), **or** use one-shot CLI commands with no persistent daemon running.

### Endpoints

| Method | Route | Description |
|---|---|---|
| `GET` | `/status` | Connection state & authenticated user info |
| `POST` | `/connect` | Request pairing code (`{"phoneNumber": "..."}`) |
| `GET` | `/pairing-code` | Get active pairing code |
| `POST` | `/disconnect` | Disconnect WhatsApp |
| `GET` | `/chats` | Get chats (`?limit=50&offset=0&isGroup=true`) |
| `GET` | `/chats/search` | Search chats (`?query=...`) |
| `GET` | `/contacts` | Get contacts (`?limit=50&offset=0`) |
| `GET` | `/messages` | Read messages (`?chatId=...&limit=20`) |
| `POST` | `/messages/search` | Multi-filter message search |
| `GET` | `/messages/:id` | Get message by ID |
| `POST` | `/messages/send` | Send text message (`{"to":"...", "text":"..."}`) |
| `POST` | `/messages/reply` | Reply to message (`{"messageId":"...", "text":"..."}`) |
| `POST` | `/messages/send-attachment` | Send attachment (`{"to":"...", "file":"...", "caption":"..."}`) |
| `POST` | `/messages/reply-attachment` | Reply with attachment (`{"messageId":"...", "file":"..."}`) |
| `GET` | `/messages/:id/download` | Download attachment (`?raw=true` to stream binary) |

---

## Programmatic AI Agent SDK

For agent frameworks that call the skill in-process rather than through the CLI:

```typescript
import { WhatsAppSkill } from 'whatsapp-messaging-skill';

const skill = new WhatsAppSkill();

// Real-time message listener
skill.onMessage(async (msg) => {
  console.log(`Received ${msg.messageType} from ${msg.senderName}: ${msg.text}`);

  if (msg.text.toLowerCase().includes('help')) {
    await skill.replyToMessage(msg.messageId, 'How can I assist you today?');
  }
});

// Powerful search
const results = await skill.searchMessages({
  query: 'contract',
  hasAttachment: true,
  since: 'this month',
});
```

---

## Configuration (`.env`)

| Variable | Default | Description |
|---|---|---|
| `WHATSAPP_AUTH_DIR` | `./data/auth` | Location for Baileys auth credentials (`0700` permission) |
| `WHATSAPP_DB_PATH` | `./data/whatsapp.db` | SQLite database file location |
| `WHATSAPP_ATTACHMENTS_DIR` | `./data/attachments` | Local directory for saved attachments |
| `AUTO_DOWNLOAD_MEDIA` | `true` | Automatically download incoming media |
| `MAX_AUTO_DOWNLOAD_SIZE_MB` | `50` | Maximum file size (MB) for automatic download |
| `PORT` | `3333` | HTTP daemon port |
| `HOST` | `127.0.0.1` | HTTP daemon host |
| `WHATSAPP_API_KEY` | `""` | Optional API key for HTTP header `x-api-key` |
| `LOG_LEVEL` | `info` | Logging verbosity (`debug`, `info`, `warn`, `error`, `silent`) |

---

## Running Tests

Execute the comprehensive automated test suite:
```bash
npm test
```
The suite verifies pairing code generation, session state transitions, database migrations, FTS5 searching, multi-filter combinations, attachment encryption/decryption, sending and replying.

---

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-green.svg)](https://nodejs.org)
[![Baileys](https://img.shields.io/badge/Baileys-v7.0.0-blue.svg)](https://github.com/WhiskeySockets/Baileys)

