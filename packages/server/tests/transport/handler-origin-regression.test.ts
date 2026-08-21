import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { collectSourceFiles, parseImports } from '../helpers/import-scan';
import { handleNotificationAcknowledge } from '@/transport/websocket/handlers/misc';
import type { ServerMessage } from '@prokopai/sdk';

const websocketDir = resolve(import.meta.dir, '../../src/transport/websocket');

const SOCKET_KEYED_LOOKUPS = ['getConnectionBySocket', 'getClientIdForSocket', 'isClientRegistered'];

describe('transport handler origin regression', () => {
  test('socket-keyed registry lookups stay confined to the bun adapter', () => {
    const offenders: string[] = [];

    for (const file of collectSourceFiles(websocketDir)) {
      const isAdapter = file.endsWith('bun-adapter.ts');
      if (isAdapter) continue;

      const imports = parseImports(readFileSync(file, 'utf8'), file);
      for (const imp of imports) {
        if (!imp.specifier.includes('connection-registry')) continue;
        for (const name of SOCKET_KEYED_LOOKUPS) {
          if (imp.names.includes(name)) {
            offenders.push(`${file} imports ${name}`);
          }
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  test('handlers treat the opaque ConnectionId as a registry key, never as a socket', () => {
    const sent: ServerMessage[] = [];
    const ctx = {
      send: (_id: unknown, message: ServerMessage) => {
        sent.push(message);
      },
      broadcast: () => {},
      broadcastToSession: () => {},
      sendToController: () => {},
      sendToAskTargets: () => {},
      clients: new Map(),
    };

    handleNotificationAcknowledge(ctx as never, 'unknown-id' as never, {
      type: 'notification.acknowledge',
      eventId: 'evt-1',
      sessionId: 'session-1',
    });

    expect(sent).toEqual([]);
  });
});
