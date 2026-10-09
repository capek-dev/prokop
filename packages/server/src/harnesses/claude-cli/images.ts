import { lstatSync, realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';
import type { Session } from '@prokopai/sdk';
import { getAttachment, MAX_ATTACHMENT_SIZE, validateImageMime, type Attachment } from '@/infrastructure/sqlite/attachments';
import { getAttachmentDir } from '@/infrastructure/runtime/paths';

export interface ClaudeImage extends Attachment {
  data: string;
}

/**
 * Validate ownership and the actual file before any native prompt can be
 * submitted. Synchronous (metadata only) so the caller's turn guards stay
 * atomic; `loadClaudeImages` reads the bytes once the turn is claimed.
 */
export function resolveClaudeImages(session: Session, references: Array<{ id: string; kind: string }>): Attachment[] | null {
  if (references.length > 10) return null;
  const images: Attachment[] = [];
  const directory = getAttachmentDir(session.workspaceId, session.id);
  for (const reference of references) {
    if (reference?.kind !== 'image' || typeof reference.id !== 'string') return null;
    const image = getAttachment(session.id, reference.id);
    if (!image || image.workspaceId !== session.workspaceId || image.kind !== 'image'
      || !validateImageMime(image.mimeType) || image.sizeBytes < 1 || image.sizeBytes > MAX_ATTACHMENT_SIZE) return null;
    try {
      const stat = lstatSync(image.absolutePath);
      const file = realpathSync(image.absolutePath);
      const offset = relative(realpathSync(directory), file);
      if (!offset || offset === '..' || offset.startsWith(`..${sep}`) || isAbsolute(offset)
        || !stat.isFile() || stat.isSymbolicLink() || stat.size !== image.sizeBytes) return null;
      images.push({ ...image, absolutePath: file });
    } catch { return null; }
  }
  return images;
}

/** Reads validated images off the event loop; a file that changed size since validation fails the turn. */
export async function loadClaudeImages(images: Attachment[]): Promise<ClaudeImage[]> {
  return Promise.all(images.map(async (image) => {
    const data = await readFile(image.absolutePath);
    if (data.length !== image.sizeBytes) throw new Error('Claude image attachment is unavailable or unsupported');
    return { ...image, data: data.toString('base64') };
  }));
}
