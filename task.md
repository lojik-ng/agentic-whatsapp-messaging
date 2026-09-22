/goal

Create a reusable **WhatsApp Web skill for an AI Agent** using:

`https://github.com/WhiskeySockets/Baileys`

The skill must allow an AI Agent to connect a WhatsApp account, read and search messages, send and reply to messages, and **download/send WhatsApp attachments of all supported types**.

## 1. WhatsApp Pairing

**Do not use QR-code authentication.**

The skill must use **WhatsApp pairing code authentication**.

The flow should be:

1. Start the Baileys connection.
2. Ask the user for the WhatsApp phone number, including country code.
3. Request a WhatsApp pairing code using the current Baileys API.
4. Display the pairing code clearly to the user.
5. Instruct the user to enter the code in WhatsApp's linked-device flow.
6. Detect successful authentication.
7. Persist authentication credentials securely.
8. Automatically reconnect using the saved session after restart.
9. Detect logout/session invalidation and allow a new pairing.
10. Provide connection-state information such as:

- Disconnected
- Connecting
- Waiting for pairing
- Pairing
- Connected
- Logged out

The skill must not depend on displaying or refreshing QR codes.

## 2. AI Agent Operations

Expose simple, agent-friendly operations such as:

```text
connectWhatsApp(phoneNumber)
getConnectionStatus()
getPairingCode()
disconnectWhatsApp()

getChats()
searchChats()
getContacts()
searchContacts()

readMessages()
searchMessages()
getMessage()

sendMessage()
replyToMessage()

downloadAttachment()
sendAttachment()
```

Keep Baileys-specific implementation details hidden behind the skill interface.

## 3. Message Search

Implement a powerful searchable message history.

Support combining filters including:

- Sender
- Sender name
- Phone number
- Recipient
- Chat
- Group
- Private chat
- Date/time range
- Before/after a date
- Text/keyword
- Exact phrase
- Message ID
- Message type
- Read/unread status where available
- Has attachment
- Attachment/media type
- Quoted/replied message

Examples:

```text
Find all messages from John between 1 September and 15 September.

Find messages from ABC School containing "payment" this month.

Show messages with documents received from this group yesterday.

Show unread messages from schools received today.
```

Support pagination, sorting, result limits, and efficient searching.

Return useful metadata:

```text
messageId
chatId
sender
senderName
recipient
timestamp
messageType
text/content
isGroup
groupName
quotedMessage
isRead
attachment metadata
```

## 4. Local Message Index

Design the skill with a local searchable storage/index rather than relying solely on repeatedly querying WhatsApp.

Use an appropriate database/storage layer to index available message information, including:

- Message ID
- Chat
- Sender
- Recipient
- Timestamp
- Message type
- Text/content
- Read status where available
- Attachment metadata
- Attachment location/path
- Quoted-message relationship

Support efficient queries such as:

```text
sender + date range
chat + date range
keyword + sender
keyword + date range
attachment type + date range
```

Clearly separate:

```text
Baileys Connection
        ↓
Message/Event Handler
        ↓
Message & Attachment Storage
        ↓
Search/Query Layer
        ↓
AI Agent Skill Interface
```

## 5. Attachments and Media

Attachments must be fully supported as first-class WhatsApp messages.

The skill should be able to **receive, download, store, search, and send** supported attachment/media types available through the current Baileys API.

Support, where applicable:

- Images
- Videos
- Audio
- Voice notes
- Documents
- PDFs
- Spreadsheets
- Presentations
- Text files
- Other document/file types
- Stickers
- Contact cards/vCards
- Location messages
- Other supported WhatsApp message/media types

For incoming attachments, the skill should be able to:

1. Detect the attachment.
2. Extract metadata.
3. Download the actual content.
4. Store it securely.
5. Associate it with the corresponding message.
6. Return the local file/reference information to the AI Agent.
7. Avoid unnecessary re-downloads.

Attachment metadata should include, where available:

```text
messageId
filename
mimeType
fileSize
mediaType
caption
timestamp
sender
chat
localPath/reference
```

The AI Agent should be able to perform requests such as:

> "Download the PDF John sent yesterday."

> "Show me all documents received from ABC School this month."

> "Download all images from this chat between Monday and Friday."

## 6. Sending Attachments

Support sending attachments to contacts and groups.

Provide a simple interface such as:

```text
sendAttachment(
  to,
  file,
  caption?,
  options?
)
```

Support:

- Files/documents
- Images
- Videos
- Audio
- Voice notes
- PDFs
- Other supported media types

The skill should determine the appropriate WhatsApp message/media type from the supplied file where possible.

Also support:

```text
replyWithAttachment(
  messageId,
  file,
  caption?
)
```

The AI Agent should be able to naturally perform:

> "Send this PDF to the school."

> "Reply to that message with this image."

> "Send this document to the PTA group with the caption 'Meeting agenda'."

## 7. Incoming Message Events

Expose incoming messages/events to the AI Agent.

Include:

- Sender
- Sender name
- Chat
- Message ID
- Timestamp
- Message text
- Message type
- Group/private status
- Group name
- Quoted message
- Attachment/media metadata
- Attachment reference/path where downloaded

Ensure duplicate events are handled safely.

## 8. Reliability

Handle properly:

- Pairing-code generation
- Pairing-code expiry/failure
- Authentication
- Connection loss
- Automatic reconnection
- Session persistence
- Logout
- Session invalidation
- Duplicate messages/events
- Message send failures
- Attachment download failures
- Attachment upload/send failures
- Large files
- Unsupported file types
- Graceful shutdown

## 9. Security and Privacy

Securely handle:

- Authentication credentials
- Session data
- Message history
- Attachments
- Phone numbers
- Contact information
- Configuration secrets

Do not expose Baileys credentials or sensitive session information through the AI Agent interface.

Restrict access to stored messages and attachments appropriately.

## 10. Testing

Include tests for at least:

- Pairing-code authentication
- Session persistence
- Reconnection
- Logout
- Incoming messages
- Message search
- Sender/date filtering
- Keyword filtering
- Pagination
- Sending messages
- Replying
- Receiving attachments
- Downloading attachments
- Sending attachments
- Replying with attachments
- Group messaging
- Error handling

## 11. Deliverables

Provide:

- Complete skill implementation
- AI Agent tool/function definitions
- Pairing-code authentication
- Secure session persistence
- Message database/index
- Attachment storage
- Attachment download functionality
- Attachment sending functionality
- Search/filter functionality
- Connection-state management
- Logging and error handling
- Configuration/environment variables
- Setup instructions
- Usage examples
- Tests

Use the **current Baileys API and recommended patterns from the referenced repository**. Do not rely on outdated Baileys examples or deprecated authentication flows.

The final result should be a robust WhatsApp skill through which an AI Agent can naturally:

> Connect a WhatsApp account using a pairing code.

> Read and search messages by sender, chat, date, keyword, message type, and attachment.

> Download incoming documents and media.

> Send messages and attachments.

> Reply to specific messages, including replies containing attachments.

> Maintain the WhatsApp session across restarts.

The result should be a complete WhatsApp agent interface, not merely a thin send/receive wrapper around Baileys.
