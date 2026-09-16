import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { CodexProviderConfig, ProviderAccountStatus } from '@prokopai/sdk';
import { NotFoundError } from '@/application/http-errors';
import { buildCodexConfig, parseIdTokenClaims, type OAuthTokenSet } from '@/domains/provider-accounts/oauth';
import { getProviderPath } from '@/infrastructure/runtime/paths';

const configSchema = z.object({
  type: z.literal('oauth'),
  provider: z.literal('codex'),
  access: z.string().min(1),
  refresh: z.string().min(1),
  expires: z.number().finite(),
  connectedAt: z.string(),
  accountId: z.string().min(1).optional(),
});
const accountSchema = z.object({
  id: z.string().min(1),
  revision: z.string().min(1),
  connectionId: z.string().min(1),
  label: z.string().min(1),
  subject: z.string().optional(),
  reauthRequired: z.boolean(),
  config: configSchema,
});
const storeSchema = z.object({
  version: z.literal(1),
  activeAccountId: z.string().nullable(),
  accounts: z.array(accountSchema),
}).refine((data) => new Set(data.accounts.map(a => a.id)).size === data.accounts.length
  && (data.activeAccountId === null || data.accounts.some(a => a.id === data.activeAccountId)));

export type CodexAccount = z.infer<typeof accountSchema>;
type AccountStore = z.infer<typeof storeSchema>;

export class CodexAccountStore {
  constructor(
    private readonly path: () => string,
    private changed: (status: ProviderAccountStatus) => void = () => {},
  ) {}

  setChangeListener(listener: (status: ProviderAccountStatus) => void): void {
    this.changed = listener;
  }

  private read(): AccountStore {
    const path = this.path();
    if (!existsSync(path)) return { version: 1, activeAccountId: null, accounts: [] };
    // Do not turn unreadable/corrupt credentials into an empty writable store.
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      throw new Error('Unable to read Codex account configuration');
    }
    const current = storeSchema.safeParse(raw);
    if (current.success) return current.data;
    const legacy = configSchema.safeParse(raw);
    if (!legacy.success) throw new Error('Invalid Codex account configuration');
    return {
      version: 1,
      activeAccountId: 'legacy',
      accounts: [{ id: 'legacy', revision: 'legacy', connectionId: 'legacy', label: 'Account 1', reauthRequired: false, config: legacy.data }],
    };
  }

  private write(data: AccountStore): void {
    const path = this.path();
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temp, JSON.stringify(data, null, 2), { mode: 0o600, flag: 'wx' });
      renameSync(temp, path);
    } finally {
      if (existsSync(temp)) unlinkSync(temp);
    }
  }

  status(): ProviderAccountStatus {
    const data = this.read();
    const active = data.accounts.find(a => a.id === data.activeAccountId);
    return {
      provider: 'codex',
      connected: !!active && !active.reauthRequired,
      connectedAt: active?.config.connectedAt,
      accountId: active?.config.accountId,
      reauthRequired: active?.reauthRequired,
      activeAccountId: data.activeAccountId,
      accounts: data.accounts.map(a => ({
        id: a.id, label: a.label, connectedAt: a.config.connectedAt,
        connectionId: a.connectionId, reauthRequired: a.reauthRequired,
      })),
    };
  }

  get(id?: string): CodexAccount | null {
    const data = this.read();
    return data.accounts.find(a => a.id === (id ?? data.activeAccountId)) ?? null;
  }

  add(tokens: OAuthTokenSet): void {
    const config = configSchema.parse(buildCodexConfig(tokens, Date.now()));
    const claims = tokens.id_token ? parseIdTokenClaims(tokens.id_token) : undefined;
    const subject = typeof claims?.sub === 'string' ? claims.sub : undefined;
    const email = typeof claims?.email === 'string' && claims.email.trim() ? claims.email.trim().slice(0, 200) : undefined;
    const data = this.read();
    const existing = config.accountId ? data.accounts.find(a => a.config.accountId === config.accountId
      && (!a.subject || a.subject === subject)) : undefined;
    const id = existing?.id ?? randomUUID();
    const record: CodexAccount = {
      id, revision: randomUUID(), connectionId: randomUUID(), subject,
      label: email ?? existing?.label ?? `Account ${data.accounts.length + 1}`,
      reauthRequired: false, config,
    };
    if (existing) data.accounts[data.accounts.indexOf(existing)] = record;
    else data.accounts.push(record);
    // Only the first connection selects itself. Adding accounts never switches usage.
    if (data.accounts.length === 1 && !existing) data.activeAccountId = id;
    this.write(data);
    this.changed(this.status());
  }

  activate(id: string): void {
    const data = this.read();
    if (!data.accounts.some(a => a.id === id)) throw new NotFoundError('Codex account not found');
    data.activeAccountId = id;
    this.write(data);
    this.changed(this.status());
  }

  remove(id: string): void {
    const data = this.read();
    if (!data.accounts.some(a => a.id === id)) throw new NotFoundError('Codex account not found');
    data.accounts = data.accounts.filter(a => a.id !== id);
    if (data.activeAccountId === id) data.activeAccountId = null;
    this.write(data);
    this.changed(this.status());
  }

  disconnect(): void {
    this.read();
    // Keep an explicit empty collection, so no legacy credentials can reappear.
    this.write({ version: 1, activeAccountId: null, accounts: [] });
    this.changed(this.status());
  }

  updateCredentials(account: CodexAccount, config: CodexProviderConfig, reauthRequired = false): CodexAccount | null {
    const data = this.read();
    const current = data.accounts.find(a => a.id === account.id);
    // A late refresh must not resurrect removed accounts or overwrite a new login.
    if (!current || current.revision !== account.revision) return current ?? null;
    current.config = configSchema.parse(config);
    current.reauthRequired = reauthRequired;
    current.revision = randomUUID();
    this.write(data);
    if (reauthRequired !== account.reauthRequired) this.changed(this.status());
    return current;
  }
}

export const codexAccounts = new CodexAccountStore(() => getProviderPath('codex'));
