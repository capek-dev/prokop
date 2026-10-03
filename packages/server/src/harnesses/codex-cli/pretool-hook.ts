import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server, type Socket } from 'node:net';
import { getPermissionTimeoutMs } from '@/infrastructure/runtime/environment';
import { spawnCodexAppServer, CodexAppServer, codexObject, type CodexConnection } from './app-server';
import { validHookCall, type CodexHookCall } from './hook-policy';
import { logCodexPermissionDenial } from './permission-diagnostics';
import { sessionTempEnvironment } from '@/infrastructure/filesystem/session-temp';

const MAX_INPUT = 128 * 1024;
// The hook runs in Codex's shell. Keep its code inline for compiled Prokop binaries.
const HOOK_SCRIPT = `const net=require('node:net');let data='';process.stdin.setEncoding('utf8');process.stdin.on('data',part=>{data+=part;if(data.length>131072)process.exit(2)});process.stdin.on('end',()=>{const socket=net.connect(process.env.PROKOPAI_CODEX_HOOK_SOCKET);socket.setTimeout(Number(process.env.PROKOPAI_CODEX_HOOK_TIMEOUT_MS));socket.on('connect',()=>socket.end(JSON.stringify({token:process.env.PROKOPAI_CODEX_HOOK_TOKEN,call:JSON.parse(data)})));let result='';socket.setEncoding('utf8');socket.on('data',part=>{result+=part;if(result.length>256)process.exit(2)});socket.on('end',()=>{if(result.trim()==='allow')process.exit(0);const reasons={'working-directory':'working directory outside selected root','unknown-turn':'unknown or not-yet-started agent turn','workspace-changed':'workspace changed or connection closed','unsupported-command':'unsupported command payload','permission-denied':'permission not granted','no-active-turn':'no active parent turn'};const reason=reasons[result.trim().slice(5)];console.error('Denied by Prokop permission check'+(result.startsWith('deny:')&&reason?' ('+reason+')':''));process.exit(2)});socket.on('error',()=>{console.error('Prokop permission check unavailable');process.exit(2)});socket.on('timeout',()=>{console.error('Prokop permission check timed out');process.exit(2)})})`;

function quote(value: string): string { return `'${value.replace(/'/g, "'\\''")}'`; }

export function hookCommand(): string { return `node -e ${quote(HOOK_SCRIPT)}`; }

export function hookConfig(): string {
  return `hooks.PreToolUse=[{matcher="^(Bash|apply_patch)$",hooks=[{type="command",command=${JSON.stringify(hookCommand())},timeout=${Math.ceil(getPermissionTimeoutMs() / 1000) + 30}}]}]`;
}

interface ListedHook {
  key: string;
  currentHash: string;
  trustStatus: string;
  source: string;
  enabled: boolean;
  eventName: string;
}

export function selectProkopHook(response: unknown, expectedTrust: 'untrusted' | 'trusted' | 'either'): ListedHook {
  const data = codexObject(response)?.data;
  if (!Array.isArray(data) || data.length !== 1) throw new Error('Codex hook discovery failed');
  const entry = codexObject(data[0]);
  if (!entry || !Array.isArray(entry.hooks) || Array.isArray(entry.warnings) && entry.warnings.length > 0
    || Array.isArray(entry.errors) && entry.errors.length > 0) {
    throw new Error('Codex hook diagnostics failed');
  }
  const hooks = entry.hooks.map(codexObject).filter(hook => hook?.source === 'sessionFlags'
    && hook.eventName === 'preToolUse');
  if (hooks.length !== 1 || hooks[0]?.enabled !== true
    || (expectedTrust === 'either' ? !['untrusted', 'trusted'].includes(String(hooks[0]?.trustStatus))
      : hooks[0]?.trustStatus !== expectedTrust)
    || hooks[0]?.matcher !== '^(Bash|apply_patch)$' || hooks[0]?.command !== hookCommand()
    || typeof hooks[0]?.key !== 'string' || !hooks[0].key.startsWith('/<session-flags>/config.toml:pre_tool_use:')
    || typeof hooks[0]?.currentHash !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(hooks[0].currentHash as string)) {
    throw new Error('Prokop Codex hook is not active and trusted');
  }
  return hooks[0] as unknown as ListedHook;
}

export type HookDecision = boolean | 'working-directory' | 'unknown-turn' | 'workspace-changed'
  | 'unsupported-command' | 'permission-denied' | 'no-active-turn';

export interface PretoolChannel {
  connect(): CodexConnection;
  close(): Promise<void>;
}

/** The only listener is a private per-turn Unix socket; a token is required on every connection. */
export async function createPretoolChannel(
  onCall: (call: CodexHookCall) => Promise<HookDecision>,
  spawn: typeof spawnCodexAppServer = spawnCodexAppServer,
  tempDirectory?: string,
): Promise<PretoolChannel> {
  if (process.platform === 'win32') throw new Error('Codex PreToolUse channel requires a Unix socket');
  if (!Bun.which('node')) throw new Error('Node.js is required for Codex PreToolUse');
  const directory = mkdtempSync(join(tmpdir(), 'prokop-codex-'));
  const socketPath = join(directory, 'hook.sock');
  const token = crypto.randomUUID();
  const sockets = new Set<Socket>();
  const server: Server = createServer({ allowHalfOpen: true }, socket => {
    sockets.add(socket);
    socket.setTimeout(getPermissionTimeoutMs() + 30_000, () => socket.destroy());
    let buffer = '';
    socket.on('data', chunk => {
      buffer += chunk.toString();
      if (buffer.length > MAX_INPUT) {
        logCodexPermissionDenial('hook', 'invalid-payload');
        socket.destroy();
      }
    });
    socket.on('end', () => {
      void (async () => {
        try {
          let envelope: unknown;
          try { envelope = JSON.parse(buffer) as unknown; }
          catch {
            logCodexPermissionDenial('hook', 'invalid-payload');
            socket.end('deny');
            return;
          }
          const body = codexObject(envelope);
          const reason = body?.token !== token ? 'invalid-token' as const
            : !validHookCall(body.call) ? 'invalid-payload' as const : null;
          const decision = reason ? false : await onCall(body!.call as CodexHookCall);
          if (decision !== true) logCodexPermissionDenial('hook', reason
            ?? (typeof decision === 'string' ? decision : 'permission-denied'));
          socket.end(decision === true ? 'allow' : typeof decision === 'string'
            && ['working-directory', 'unknown-turn', 'workspace-changed', 'unsupported-command',
              'permission-denied', 'no-active-turn'].includes(decision) ? `deny:${decision}` : 'deny');
        } catch {
          logCodexPermissionDenial('hook', 'handler-error');
          socket.end('deny');
        }
      })();
    });
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => logCodexPermissionDenial('hook', 'socket-error'));
  });
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
    const env = { ...process.env, ...(tempDirectory ? sessionTempEnvironment(tempDirectory) : {}), PROKOPAI_CODEX_HOOK_SOCKET: socketPath,
      PROKOPAI_CODEX_HOOK_TOKEN: token, PROKOPAI_CODEX_HOOK_TIMEOUT_MS: String(getPermissionTimeoutMs() + 30_000) };
    const args = ['--enable', 'hooks', '-c', hookConfig(),
      ...(tempDirectory ? ['-c', `sandbox_workspace_write.writable_roots=${JSON.stringify([tempDirectory])}`,
        '-c', 'sandbox_workspace_write.exclude_tmpdir_env_var=true',
        '-c', 'sandbox_workspace_write.exclude_slash_tmp=true'] : [])];
    const discover = new CodexAppServer(spawn(args, env), () => {});
    let key: string;
    let currentHash: string;
    try {
      await discover.initialize();
      ({ key, currentHash } = selectProkopHook(await discover.request('hooks/list', {}), 'either'));
    } finally { await discover.close(); }
    const state = `hooks.state={${JSON.stringify(key)}={trusted_hash=${JSON.stringify(currentHash)}}}`;
    const trustedArgs = [...args, '-c', state];
    return {
      connect: () => spawn(trustedArgs, env),
      close: async () => {
        for (const socket of sockets) socket.destroy();
        await new Promise<void>(resolve => server.close(() => resolve()));
        rmSync(directory, { recursive: true, force: true });
      },
    };
  } catch (error) {
    for (const socket of sockets) socket.destroy();
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function verifyPretoolHook(client: CodexAppServer): Promise<void> {
  selectProkopHook(await client.request('hooks/list', {}), 'trusted');
}
