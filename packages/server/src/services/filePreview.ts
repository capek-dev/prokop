/**
 * Compatibility forwarder (S5 filesystem isolation). The preview pipeline
 * moved to `infrastructure/filesystem/file-preview.ts`; the export
 * identities stay unchanged. The function is built once over the C6
 * workspace path policy adapter, exactly like the pre-slice service.
 */

import { workspacePathPolicyPort } from '@/adapters/capek/workspace-paths';
import { createFilePreview } from '@/infrastructure/filesystem/file-preview';

export {
  getLanguageForPath,
  getMimeTypeForPath,
} from '@/infrastructure/filesystem/file-preview';

export const getFilePreview = createFilePreview(workspacePathPolicyPort);
