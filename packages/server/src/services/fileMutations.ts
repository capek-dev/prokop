/**
 * Compatibility forwarder (S5 filesystem isolation). The editable
 * read/save implementation moved to
 * `infrastructure/filesystem/file-mutations.ts`; the export identities and
 * exact symlink/realpath semantics stay unchanged. The ops are built once
 * over the C6 workspace path policy adapter, exactly like the pre-slice
 * service.
 */

import { workspacePathPolicyPort } from '@/adapters/capek/workspace-paths';
import { createEditableFileOps } from '@/infrastructure/filesystem/file-mutations';

const ops = createEditableFileOps(workspacePathPolicyPort);

export const readEditableFile = ops.readEditableFile;
export const saveFile = ops.saveFile;
export type { SaveFileInput, WorkspaceLike } from '@/infrastructure/filesystem/file-mutations';
