import http from 'http';
import { URL } from 'url';
import fs from 'fs';
import { WhatsAppSkill } from '../skill/operations.js';
import { config } from '../config.js';

export function createServer(skill: WhatsAppSkill): http.Server {
  const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    // Optional API key validation
    if (config.apiKey) {
      const apiKeyHeader = req.headers['x-api-key'];
      const apiKeyQuery = parsedUrl.searchParams.get('apiKey');
      if (apiKeyHeader !== config.apiKey && apiKeyQuery !== config.apiKey) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized: Invalid or missing API key' }));
        return;
      }
    }

    try {
      // 1. Connection endpoints
      if (req.method === 'GET' && pathname === '/status') {
        const status = await skill.getConnectionStatus();
        sendJson(res, 200, status);
        return;
      }

      if (req.method === 'POST' && pathname === '/connect') {
        const body = await parseJsonBody(req);
        if (!body.phoneNumber) {
          sendJson(res, 400, { error: 'Missing required field "phoneNumber"' });
          return;
        }
        const result = await skill.connectWhatsApp(body.phoneNumber);
        sendJson(res, 200, result);
        return;
      }

      if (req.method === 'GET' && pathname === '/pairing-code') {
        const code = await skill.getPairingCode();
        if (!code) {
          sendJson(res, 404, { error: 'No active pairing code' });
          return;
        }
        sendJson(res, 200, code);
        return;
      }

      if (req.method === 'POST' && pathname === '/disconnect') {
        await skill.disconnectWhatsApp();
        sendJson(res, 200, { success: true, message: 'Disconnected WhatsApp' });
        return;
      }

      // 2. Chat & Contact endpoints
      if (req.method === 'GET' && pathname === '/chats') {
        const limit = parseInt(parsedUrl.searchParams.get('limit') || '50', 10);
        const offset = parseInt(parsedUrl.searchParams.get('offset') || '0', 10);
        const isGroupParam = parsedUrl.searchParams.get('isGroup');
        const isGroup = isGroupParam === 'true' ? true : (isGroupParam === 'false' ? false : undefined);

        const chats = await skill.getChats({ limit, offset, isGroup });
        sendJson(res, 200, chats);
        return;
      }

      if (req.method === 'GET' && pathname === '/chats/search') {
        const query = parsedUrl.searchParams.get('query') || '';
        const chats = await skill.searchChats(query);
        sendJson(res, 200, chats);
        return;
      }

      if (req.method === 'GET' && pathname === '/contacts') {
        const limit = parseInt(parsedUrl.searchParams.get('limit') || '50', 10);
        const offset = parseInt(parsedUrl.searchParams.get('offset') || '0', 10);
        const contacts = await skill.getContacts({ limit, offset });
        sendJson(res, 200, contacts);
        return;
      }

      if (req.method === 'GET' && pathname === '/contacts/search') {
        const query = parsedUrl.searchParams.get('query') || '';
        const contacts = await skill.searchContacts(query);
        sendJson(res, 200, contacts);
        return;
      }

      // 3. Message Reading & Search endpoints
      if (req.method === 'GET' && pathname === '/messages') {
        const chatId = parsedUrl.searchParams.get('chatId');
        if (!chatId) {
          sendJson(res, 400, { error: 'Missing required query parameter "chatId"' });
          return;
        }
        const limit = parseInt(parsedUrl.searchParams.get('limit') || '20', 10);
        const before = parsedUrl.searchParams.get('before') || undefined;
        const messages = await skill.readMessages(chatId, { limit, before });
        sendJson(res, 200, messages);
        return;
      }

      if ((req.method === 'GET' || req.method === 'POST') && pathname === '/messages/search') {
        let filters: any = {};
        if (req.method === 'POST') {
          filters = await parseJsonBody(req);
        } else {
          // Parse query params into filters
          for (const [key, value] of parsedUrl.searchParams.entries()) {
            if (key === 'limit' || key === 'offset') {
              filters[key] = parseInt(value, 10);
            } else if (key === 'isGroup' || key === 'isRead' || key === 'hasAttachment') {
              filters[key] = value === 'true';
            } else {
              filters[key] = value;
            }
          }
        }

        const results = await skill.searchMessages(filters);
        sendJson(res, 200, results);
        return;
      }

      // Single message lookup: /messages/:id
      const messageMatch = pathname.match(/^\/messages\/([^/]+)$/);
      if (req.method === 'GET' && messageMatch) {
        const id = messageMatch[1];
        const msg = await skill.getMessage(id);
        if (!msg) {
          sendJson(res, 404, { error: `Message with ID "${id}" not found` });
          return;
        }
        sendJson(res, 200, msg);
        return;
      }

      // 4. Message Sending endpoints
      if (req.method === 'POST' && pathname === '/messages/send') {
        const body = await parseJsonBody(req);
        if (!body.to || !body.text) {
          sendJson(res, 400, { error: 'Missing required fields: "to" and "text"' });
          return;
        }
        const msg = await skill.sendMessage(body.to, body.text, {
          quotedMessageId: body.quotedMessageId,
        });
        sendJson(res, 200, msg);
        return;
      }

      if (req.method === 'POST' && pathname === '/messages/reply') {
        const body = await parseJsonBody(req);
        if (!body.messageId || !body.text) {
          sendJson(res, 400, { error: 'Missing required fields: "messageId" and "text"' });
          return;
        }
        const msg = await skill.replyToMessage(body.messageId, body.text);
        sendJson(res, 200, msg);
        return;
      }

      // 5. Attachment endpoints
      if (req.method === 'POST' && pathname === '/messages/send-attachment') {
        const body = await parseJsonBody(req);
        if (!body.to || !body.file) {
          sendJson(res, 400, { error: 'Missing required fields: "to" and "file"' });
          return;
        }
        const msg = await skill.sendAttachment(body.to, body.file, body.caption, {
          mediaType: body.mediaType,
          fileName: body.fileName,
          mimeType: body.mimeType,
          quotedMessageId: body.quotedMessageId,
        });
        sendJson(res, 200, msg);
        return;
      }

      if (req.method === 'POST' && pathname === '/messages/reply-attachment') {
        const body = await parseJsonBody(req);
        if (!body.messageId || !body.file) {
          sendJson(res, 400, { error: 'Missing required fields: "messageId" and "file"' });
          return;
        }
        const msg = await skill.replyWithAttachment(body.messageId, body.file, body.caption, {
          mediaType: body.mediaType,
          fileName: body.fileName,
          mimeType: body.mimeType,
        });
        sendJson(res, 200, msg);
        return;
      }

      // Download attachment: /messages/:id/download
      const downloadMatch = pathname.match(/^\/messages\/([^/]+)\/download$/);
      if (req.method === 'GET' && downloadMatch) {
        const id = downloadMatch[1];
        const attachment = await skill.downloadAttachment(id);

        const serveRaw = parsedUrl.searchParams.get('raw') === 'true';
        if (serveRaw && attachment.localPath && fs.existsSync(attachment.localPath)) {
          res.writeHead(200, {
            'Content-Type': attachment.mimeType,
            'Content-Length': attachment.fileSize,
            'Content-Disposition': `inline; filename="${attachment.filename}"`,
          });
          fs.createReadStream(attachment.localPath).pipe(res);
          return;
        }

        sendJson(res, 200, attachment);
        return;
      }

      // Fallback 404
      sendJson(res, 404, { error: `Endpoint not found: ${req.method} ${pathname}` });
    } catch (err: any) {
      sendJson(res, 500, { error: err?.message || 'Internal server error' });
    }
  });

  return server;
}

function sendJson(res: http.ServerResponse, statusCode: number, data: any): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}

function parseJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 25 * 1024 * 1024) {
        reject(new Error('Request body payload too large (max 25MB)'));
      }
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Malformed JSON body'));
      }
    });
    req.on('error', reject);
  });
}

// Standalone execution entrypoint
if (process.argv[1]?.endsWith('server.ts') || process.argv[1]?.endsWith('server.js')) {
  const skill = new WhatsAppSkill();
  skill.init().catch(() => {});
  const server = createServer(skill);
  server.listen(config.serverPort, config.serverHost, () => {
    console.log(`WhatsApp Skill HTTP Server running on http://${config.serverHost}:${config.serverPort}`);
  });
}
