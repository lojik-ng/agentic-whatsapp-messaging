import { WhatsAppSkill } from '../skill/operations.js';
import { createServer } from '../api/server.js';
import { config } from '../config.js';

export async function runCli(args: string[] = process.argv.slice(2)): Promise<void> {
  const command = args[0];

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    printHelp();
    return;
  }

  const skill = new WhatsAppSkill();

  try {
    switch (command) {
      case 'status': {
        const status = await skill.getConnectionStatus();
        console.log(JSON.stringify(status, null, 2));
        break;
      }

      case 'connect': {
        const phone = args[1];
        if (!phone) {
          console.error('Error: Please provide a phone number with country code (e.g. 15551234567).');
          process.exit(1);
        }
        console.log(`Requesting WhatsApp pairing code for ${phone}...`);
        const result = await skill.connectWhatsApp(phone);
        console.log('\n========================================');
        console.log(`PAIRING CODE: ${result.formattedCode || result.pairingCode}`);
        console.log('========================================\n');
        result.instructions.forEach((step) => console.log(step));
        console.log('\nWaiting for authentication on phone...');
        break;
      }

      case 'pairing-code': {
        const code = await skill.getPairingCode();
        if (!code) {
          console.log('No active pairing code found or already connected.');
        } else {
          console.log(JSON.stringify(code, null, 2));
        }
        break;
      }

      case 'disconnect': {
        await skill.disconnectWhatsApp();
        console.log('WhatsApp disconnected successfully.');
        break;
      }

      case 'chats': {
        const limit = getArgNumber(args, '--limit') || 50;
        const offset = getArgNumber(args, '--offset') || 0;
        const isGroup = args.includes('--groups') ? true : (args.includes('--private') ? false : undefined);
        const chats = await skill.getChats({ limit, offset, isGroup });
        console.log(JSON.stringify(chats, null, 2));
        break;
      }

      case 'search-chats': {
        const query = args[1];
        if (!query) {
          console.error('Error: Please provide a search query.');
          process.exit(1);
        }
        const chats = await skill.searchChats(query);
        console.log(JSON.stringify(chats, null, 2));
        break;
      }

      case 'contacts': {
        const limit = getArgNumber(args, '--limit') || 50;
        const offset = getArgNumber(args, '--offset') || 0;
        const contacts = await skill.getContacts({ limit, offset });
        console.log(JSON.stringify(contacts, null, 2));
        break;
      }

      case 'search-contacts': {
        const query = args[1];
        if (!query) {
          console.error('Error: Please provide a search query.');
          process.exit(1);
        }
        const contacts = await skill.searchContacts(query);
        console.log(JSON.stringify(contacts, null, 2));
        break;
      }

      case 'messages': {
        const chatId = args[1];
        if (!chatId) {
          console.error('Error: Please provide a chatId.');
          process.exit(1);
        }
        const limit = getArgNumber(args, '--limit') || 20;
        const before = getArgValue(args, '--before');
        const messages = await skill.readMessages(chatId, { limit, before });
        console.log(JSON.stringify(messages, null, 2));
        break;
      }

      case 'get-message': {
        const messageId = args[1];
        if (!messageId) {
          console.error('Error: Please provide a messageId.');
          process.exit(1);
        }
        const msg = await skill.getMessage(messageId);
        if (!msg) {
          console.error(`Message "${messageId}" not found.`);
          process.exit(1);
        }
        console.log(JSON.stringify(msg, null, 2));
        break;
      }

      case 'search': {
        const filters: any = {
          query: getArgValue(args, '--query') || getArgValue(args, '-q'),
          exactPhrase: getArgValue(args, '--exact'),
          sender: getArgValue(args, '--sender'),
          senderName: getArgValue(args, '--sender-name'),
          phoneNumber: getArgValue(args, '--phone'),
          chat: getArgValue(args, '--chat'),
          since: getArgValue(args, '--since'),
          until: getArgValue(args, '--until'),
          messageType: getArgValue(args, '--type'),
          attachmentType: getArgValue(args, '--attachment-type'),
          limit: getArgNumber(args, '--limit'),
          offset: getArgNumber(args, '--offset'),
          sort: getArgValue(args, '--sort') as any,
        };

        if (args.includes('--groups')) filters.isGroup = true;
        if (args.includes('--private')) filters.isGroup = false;
        if (args.includes('--has-attachment')) filters.hasAttachment = true;
        if (args.includes('--unread')) filters.isRead = false;

        const results = await skill.searchMessages(filters);
        console.log(JSON.stringify(results, null, 2));
        break;
      }

      case 'send': {
        await skill.init();
        const to = getArgValue(args, '--to') || args[1];
        const text = getArgValue(args, '--text') || args[2];
        const quoted = getArgValue(args, '--quoted');
        if (!to || !text) {
          console.error('Error: Usage: whatsapp-messaging-skill send --to <recipient> --text <message>');
          process.exit(1);
        }
        const sent = await skill.sendMessage(to, text, { quotedMessageId: quoted });
        console.log(JSON.stringify(sent, null, 2));
        break;
      }

      case 'reply': {
        await skill.init();
        const messageId = getArgValue(args, '--message-id') || args[1];
        const text = getArgValue(args, '--text') || args[2];
        if (!messageId || !text) {
          console.error('Error: Usage: whatsapp-messaging-skill reply --message-id <id> --text <message>');
          process.exit(1);
        }
        const sent = await skill.replyToMessage(messageId, text);
        console.log(JSON.stringify(sent, null, 2));
        break;
      }

      case 'send-attachment': {
        await skill.init();
        const to = getArgValue(args, '--to');
        const file = getArgValue(args, '--file');
        const caption = getArgValue(args, '--caption');
        const mediaType = getArgValue(args, '--type') as any;
        const fileName = getArgValue(args, '--filename');
        const quoted = getArgValue(args, '--quoted');

        if (!to || !file) {
          console.error('Error: Usage: whatsapp-messaging-skill send-attachment --to <recipient> --file <path> [--caption <text>]');
          process.exit(1);
        }
        const sent = await skill.sendAttachment(to, file, caption, {
          mediaType,
          fileName,
          quotedMessageId: quoted,
        });
        console.log(JSON.stringify(sent, null, 2));
        break;
      }

      case 'reply-attachment': {
        await skill.init();
        const messageId = getArgValue(args, '--message-id') || args[1];
        const file = getArgValue(args, '--file') || args[2];
        const caption = getArgValue(args, '--caption');
        if (!messageId || !file) {
          console.error('Error: Usage: whatsapp-messaging-skill reply-attachment --message-id <id> --file <path>');
          process.exit(1);
        }
        const sent = await skill.replyWithAttachment(messageId, file, caption);
        console.log(JSON.stringify(sent, null, 2));
        break;
      }

      case 'download': {
        await skill.init();
        const messageId = args[1];
        if (!messageId) {
          console.error('Error: Please provide a messageId.');
          process.exit(1);
        }
        const attachment = await skill.downloadAttachment(messageId);
        console.log(JSON.stringify(attachment, null, 2));
        break;
      }

      case 'serve': {
        const port = getArgNumber(args, '--port') || config.serverPort;
        const host = getArgValue(args, '--host') || config.serverHost;
        await skill.init().catch(() => {});
        const server = createServer(skill);
        server.listen(port, host, () => {
          console.log(`WhatsApp Skill REST API Server listening on http://${host}:${port}`);
        });
        // Keep process running
        break;
      }

      default: {
        console.error(`Unknown command: ${command}`);
        printHelp();
        process.exit(1);
      }
    }
  } catch (err: any) {
    console.error(`Error: ${err?.message || err}`);
    process.exit(1);
  }
}

function getArgValue(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length && !args[idx + 1].startsWith('-')) {
    return args[idx + 1];
  }
  return undefined;
}

function getArgNumber(args: string[], flag: string): number | undefined {
  const val = getArgValue(args, flag);
  if (val) {
    const num = parseInt(val, 10);
    return isNaN(num) ? undefined : num;
  }
  return undefined;
}

function printHelp(): void {
  console.log(`
WhatsApp AI Agent Skill CLI (Baileys)

Usage:
  whatsapp-messaging-skill <command> [options]

Commands:
  status                                          Check connection state & active user
  connect <phoneNumber>                           Initiate pairing-code auth (e.g. 15551234567)
  pairing-code                                    Show current pairing code & instructions
  disconnect                                      Disconnect WhatsApp socket
  chats [--limit N] [--groups|--private]          List recent conversations
  search-chats <query>                            Search conversations by title/name
  contacts [--limit N]                            List contacts
  search-contacts <query>                         Search contacts
  messages <chatId> [--limit N] [--before DATE]   Read messages from a chat
  get-message <messageId>                         Get message details and attachment info
  search [options]                                Search messages (FTS5 + filters)
  send --to <recipient> --text <msg>              Send a text message
  reply --message-id <id> --text <msg>            Reply to a specific message
  send-attachment --to <to> --file <path>         Send media/document/image/audio
  reply-attachment --message-id <id> --file <path> Reply with an attachment
  download <messageId>                            Download media attachment for message
  serve [--port N] [--host H]                     Run background REST API daemon

Search Options:
  --query, -q <terms>      FTS5 keyword search across messages & captions
  --exact <phrase>         Exact text match
  --sender <jid|name>      Filter by sender JID
  --sender-name <name>     Filter by sender push name
  --phone <digits>         Filter by phone number
  --chat <jid|name>        Filter by chat JID or group name
  --groups / --private     Filter group or private messages
  --since <date|term>      Start date (e.g. '2026-09-01', 'yesterday', 'this month')
  --until <date|term>      End date
  --type <type>            text, image, video, audio, voice, document, sticker
  --has-attachment         Messages with attachments only
  --attachment-type <type> image, video, audio, voice, document, sticker
  --unread                 Unread messages only
  --limit N / --offset N   Pagination
`);
}

// Direct execution
if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  runCli().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
