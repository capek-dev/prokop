import { lstatSync, realpathSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';
import type { Session } from '@prokopai/sdk';
import { getAttachment, MAX_ATTACHMENT_SIZE, validateImageMime, type Attachment } from '@/infrastructure/sqlite/attachments';
import { getAttachmentDir } from '@/infrastructure/runtime/paths';

export interface ClaudeImage extends Attachment {
  data: string;
}

/** Validate ownership and the actual file before any native prompt can be submitted. */
export function resolveClaudeImages(session: Session, references: Array<{ id: string; kind: string }>): ClaudeImage[] | null {
  if (references.length > 10) return null;
  const images: ClaudeImage[] = [];
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
      const data = readFileSync(file);
      if (data.length !== image.sizeBytes) return null;
      images.push({ ...image, data: data.toString('base64') });
    } catch { return null; }
  }
  return images;
}
