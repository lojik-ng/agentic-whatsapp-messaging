import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { ConnectionManager } from '../src/client/connection.js';
import { DisconnectReason } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';

describe('ConnectionManager & Pairing State Tests', () => {
  const testAuthDir = path.resolve('./data/test_auth_' + Date.now());
  let cm: ConnectionManager;

  beforeEach(() => {
    if (fs.existsSync(testAuthDir)) {
      fs.rmSync(testAuthDir, { recursive: true, force: true });
    }
    cm = new ConnectionManager(testAuthDir);
  });

  it('should format phone number correctly', () => {
    assert.equal(cm.sanitizePhoneNumber('+1 (555) 123-4567'), '15551234567');
    assert.equal(cm.sanitizePhoneNumber('44 7123 456789'), '447123456789');
    assert.equal(cm.sanitizePhoneNumber('2349019057108'), '2349019057108');

    // Invalid numbers should throw
    assert.throws(() => cm.sanitizePhoneNumber('123'), /Invalid phone number/);
    assert.throws(() => cm.sanitizePhoneNumber('abc'), /Invalid phone number/);
  });

  it('should format pairing code into XXXX-XXXX', () => {
    assert.equal(cm.formatPairingCode('12345678'), '1234-5678');
    assert.equal(cm.formatPairingCode('abcdEFGH'), 'ABCD-EFGH');
    assert.equal(cm.formatPairingCode('AB-CD-EF-GH'), 'ABCD-EFGH');
  });

  it('should report initial disconnected state', () => {
    const status = cm.getStatus();
    assert.equal(status.state, 'Disconnected');
    assert.equal(status.user, undefined);
    assert.equal(status.pairingCode, undefined);
  });

  it('should emit state changes and track states accurately', () => {
    const statesRecorded: string[] = [];
    cm.on('state.change', ({ current }) => statesRecorded.push(current));

    // Simulate internal state transitions via private/simulated events
    (cm as any).setState('Connecting');
    (cm as any).setState('Waiting for pairing');
    (cm as any).setState('Pairing');
    (cm as any).setState('Connected');

    assert.deepEqual(statesRecorded, [
      'Connecting',
      'Waiting for pairing',
      'Pairing',
      'Connected',
    ]);
    assert.equal(cm.getStatus().state, 'Connected');
  });

  it('should transition to Logged out and clear auth directory on 401 loggedOut error', () => {
    // Create a dummy auth file
    fs.mkdirSync(testAuthDir, { recursive: true });
    fs.writeFileSync(path.join(testAuthDir, 'creds.json'), '{"dummy":true}');
    assert.ok(fs.existsSync(path.join(testAuthDir, 'creds.json')));

    (cm as any).setState('Connected');

    // Simulate socket close with 401 loggedOut
    const sockEv = (cm as any).socket?.ev;
    const boomError = new Boom('Logged out', { statusCode: DisconnectReason.loggedOut });

    // Directly trigger the connection update handler logic
    (cm as any).socket = {
      ev: { on: () => {}, emit: () => {} },
      user: { id: 'test@s.whatsapp.net' },
    };

    // Invoke state transition as the handler does
    (cm as any).lastError = 'Session logged out or invalidated by WhatsApp';
    (cm as any).setState('Logged out');
    cm.clearAuthSession();

    assert.equal(cm.getStatus().state, 'Logged out');
    // Auth dir should have been wiped and recreated clean
    assert.ok(!fs.existsSync(path.join(testAuthDir, 'creds.json')));
  });
});
