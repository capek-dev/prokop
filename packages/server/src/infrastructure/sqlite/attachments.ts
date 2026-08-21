import { getDatabase } from './database';
import { mkdirSync, writeFileSync, unlinkSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import type { AttachmentKind } from '@prokopai/sdk';
import { getAttachmentDir } from '@/infrastructure/runtime/paths';

const MAX_ATTACHMENT_SIZE = 20 * 1024 * 1024;

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

export interface AttachmentRow {
  id: string;
  session_id: string;
  workspace_id: string;
  kind: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  absolute_path: string;
  created_at: string;
  access_key: string;
}

export interface Attachment {
  id: string;
  sessionId: string;
  workspaceId: string;
  kind: AttachmentKind;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  absolutePath: string;
  createdAt: string;
  accessKey: string;
}

export { MAX_ATTACHMENT_SIZE };

function mapRowToAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    sessionId: row.session_id,
    workspaceId: row.workspace_id,
    kind: row.kind as AttachmentKind,
    filename: row.filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    absolutePath: row.absolute_path,
    createdAt: row.created_at,
    accessKey: row.access_key,
  };
}

// getAttachmentDir is now imported from ../paths

export function determineKind(mimeType: string): AttachmentKind {
  if (mimeType.startsWith('image/')) {
    return 'image';
  }
  if (mimeType.startsWith('video/')) {
    return 'video';
  }
  return 'file';
}

export function validateImageMime(mimeType: string): boolean {
  return ALLOWED_IMAGE_MIME_TYPES.has(mimeType);
}

export function getAttachment(sessionId: string, attachmentId: string): Attachment | null {
  const db = getDatabase();
  const row = db.query(
    'SELECT * FROM attachments WHERE id = ? AND session_id = ?',
  ).get(attachmentId, sessionId) as AttachmentRow | undefined;

  if (!row) {
    return null;
  }
  return mapRowToAttachment(row);
}

export function getAttachmentsForSession(sessionId: string): Attachment[] {
  const db = getDatabase();
  const rows = db.query(
    'SELECT * FROM attachments WHERE session_id = ? ORDER BY created_at DESC',
  ).all(sessionId) as AttachmentRow[];

  return rows.map(mapRowToAttachment);
}

export function getAttachmentByKey(attachmentId: string, accessKey: string): Attachment | null {
  const db = getDatabase();
  const row = db.query('SELECT * FROM attachments WHERE id = ? AND access_key = ?').get(attachmentId, accessKey) as AttachmentRow | undefined;
  if (!row) return null;
  return mapRowToAttachment(row);
}

export function createAttachment(params: {
  sessionId: string;
  workspaceId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  data: ArrayBuffer;
}): Attachment {
  const db = getDatabase();
  const id = 'att_' + crypto.randomUUID();
  const accessKey = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('hex');
  const kind = determineKind(params.mimeType);
  const attachmentDir = getAttachmentDir(params.workspaceId, params.sessionId);

  mkdirSync(attachmentDir, { recursive: true });

  const safeFilename = params.filename.replace(/[^a-zA-Z0-9.\-_]/g, '_');
  const absolutePath = join(attachmentDir, `${id}-${safeFilename}`);

  const buffer = Buffer.from(params.data);
  writeFileSync(absolutePath, buffer);

  const createdAt = new Date().toISOString();

  db.run(
    `INSERT INTO attachments (id, session_id, workspace_id, kind, filename, mime_type, size_bytes, absolute_path, created_at, access_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      params.sessionId,
      params.workspaceId,
      kind,
      params.filename,
      params.mimeType,
      params.sizeBytes,
      absolutePath,
      createdAt,
      accessKey,
    ],
  );

  return {
    id,
    sessionId: params.sessionId,
    workspaceId: params.workspaceId,
    kind,
    filename: params.filename,
    mimeType: params.mimeType,
    sizeBytes: params.sizeBytes,
    absolutePath,
    createdAt,
    accessKey,
  };
}

export function deleteAttachmentsForSession(sessionId: string): void {
  const attachments = getAttachmentsForSession(sessionId);
  const workspaceId = attachments[0]?.workspaceId || '';

  for (const attachment of attachments) {
    try {
      if (existsSync(attachment.absolutePath)) {
        unlinkSync(attachment.absolutePath);
      }
    } catch (err) {
      console.warn(`[attachments] Failed to delete file ${attachment.absolutePath}:`, err);
    }
  }

  try {
    const attachmentDir = getAttachmentDir(workspaceId, sessionId);
    if (existsSync(attachmentDir)) {
      rmSync(attachmentDir, { recursive: true, force: true });
    }
  } catch (err) {
    console.warn(`[attachments] Failed to remove attachment dir:`, err);
  }

  const db = getDatabase();
  db.run('DELETE FROM attachments WHERE session_id = ?', [sessionId]);
}

export function deleteAttachmentsForWorkspace(workspaceId: string): void {
  const sessions = getDatabase().query(
    'SELECT id FROM sessions WHERE workspace_id = ?',
  ).all(workspaceId) as Array<{ id: string }>;

  for (const session of sessions) {
    deleteAttachmentsForSession(session.id);
  }
}
