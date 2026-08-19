import { existsSync, chmodSync, writeFileSync, renameSync, unlinkSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import { getWebPushCredentialsPath } from '@/infrastructure/runtime/paths';
import webpush from 'web-push';
import type { PushSubscription } from 'web-push';

/**
 * VAPID credential file format, stored as JSON under the Jean2 data directory.
 */
export interface VapidCredentials {
  publicKey: string;
  privateKey: string;
  subject: string;
  createdAt: number;
}

let configured = false;

const DEFAULT_VAPID_SUBJECT = 'https://github.com/jean2ai/jean2';
const LEGACY_VAPID_SUBJECT = 'mailto:noreply@jean2.local';

function getSubject(): string {
  return process.env.JEAN2_WEB_PUSH_SUBJECT || DEFAULT_VAPID_SUBJECT;
}

function normalizeSubject(subject: string | undefined): string {
  if (!subject || subject === LEGACY_VAPID_SUBJECT) {
    return getSubject();
  }
  return subject;
}

/**
 * Load credentials from disk if they exist.
 * Returns null if no credentials file exists yet.
 */
export function loadVapidCredentials(): VapidCredentials | null {
  const filePath = getWebPushCredentialsPath();
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const content = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(content) as VapidCredentials;
    if (!parsed.publicKey || !parsed.privateKey) {
      return null;
    }
    return {
      ...parsed,
      subject: normalizeSubject(parsed.subject),
    };
  } catch {
    return null;
  }
}

/**
 * Atomically write a file synchronously. Used during credential generation
 * since we need the file persisted before returning credentials for the first
 * config request.
 */
function atomicWriteFileSync(filePath: string, content: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tempPath = join(dir, `.tmp-${randomUUID()}`);
  try {
    writeFileSync(tempPath, content, 'utf-8');
    renameSync(tempPath, filePath);
  } catch (err) {
    try {
      unlinkSync(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw err;
  }
}

/**
 * Generate a new VAPID key pair and persist it atomically.
 * Uses web-push's built-in key generation.
 */
function generateAndSaveCredentials(): VapidCredentials {
  const keys = webpush.generateVAPIDKeys();
  const creds: VapidCredentials = {
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
    subject: getSubject(),
    createdAt: Date.now(),
  };

  const filePath = getWebPushCredentialsPath();
  atomicWriteFileSync(filePath, JSON.stringify(creds, null, 2));

  // Restrict file permissions where supported (Unix only)
  try {
    chmodSync(filePath, 0o600);
  } catch {
    // Windows or unsupported platform; skip
  }

  return creds;
}

let cachedCredentials: VapidCredentials | null = null;

/**
 * Reset internal credential cache. Used in tests to isolate VAPID state
 * across test cases.
 */
export function resetVapidCache(): void {
  cachedCredentials = null;
  configured = false;
}

/**
 * Get VAPID credentials, generating and persisting them on first call.
 * Subsequent calls return the cached value.
 */
export function getVapidCredentials(): VapidCredentials {
  if (cachedCredentials) {
    return cachedCredentials;
  }

  cachedCredentials = loadVapidCredentials() ?? generateAndSaveCredentials();
  configureWebPush(cachedCredentials);
  return cachedCredentials;
}

/**
 * Configure the web-push library with VAPID details.
 * Called once after credentials are loaded or generated.
 */
function configureWebPush(creds: VapidCredentials): void {
  if (configured) {
    return;
  }
  webpush.setVapidDetails(creds.subject, creds.publicKey, creds.privateKey);
  configured = true;
}

/**
 * Ensure web-push is configured before sending. Called by the dispatch service.
 */
export function ensureWebPushConfigured(): void {
  if (!configured) {
    getVapidCredentials();
  }
}

/**
 * Send a push notification to a subscription.
 * Wraps web-push's sendNotification with typed error handling.
 */
export interface SendPushInput {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  payload: string;
  ttl?: number;
}

export interface SendPushResult {
  success: boolean;
  statusCode: number;
  body?: string;
}

export async function sendWebPush(input: SendPushInput): Promise<SendPushResult> {
  ensureWebPushConfigured();

  const subscription: PushSubscription = {
    endpoint: input.endpoint,
    keys: {
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
    },
  };

  try {
    const result = await webpush.sendNotification(
      subscription,
      input.payload,
      { TTL: input.ttl ?? 2419200 },
    );
    return {
      success: true,
      statusCode: result.statusCode,
      body: typeof result.body === 'string' ? result.body : undefined,
    };
  } catch (err: unknown) {
    const error = err as { statusCode?: number; body?: string; message?: string };
    return {
      success: false,
      statusCode: error.statusCode ?? 0,
      body: error.body ?? error.message,
    };
  }
}

/**
 * Whether web push is available (credentials can be generated on demand).
 * Always true unless credential generation fails.
 */
export function isWebPushAvailable(): boolean {
  try {
    getVapidCredentials();
    return true;
  } catch {
    return false;
  }
}
