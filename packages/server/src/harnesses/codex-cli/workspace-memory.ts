import type { Workspace } from '@prokopai/sdk';
import {
  formatMemorySection,
  loadMemoryFile,
  MEMORY_CHAR_LIMIT,
  USER_CHAR_LIMIT,
} from '@/adapters/capek/domain-tools';
import { resolveWorkspaceMemoryDir } from '@/infrastructure/runtime/workspace-dirs';

/** Format opted-in workspace memory for Codex without memory-tool guidance. */
export async function codexWorkspaceMemory(workspace: Workspace, root: string): Promise<string | null> {
  if (workspace.settings.memory?.enabled !== true) return null;
  const directory = resolveWorkspaceMemoryDir(root);
  const user = await loadMemoryFile(directory, 'user');
  const memory = await loadMemoryFile(directory, 'memory');
  const sections: string[] = [];
  // Files edited outside the memory tool may exceed its normal limits.
  if (user && user.charCount <= USER_CHAR_LIMIT) {
    sections.push(formatMemorySection('user_memory', user.path, user.content, user.charCount, user.charLimit));
  }
  if (memory && memory.charCount <= MEMORY_CHAR_LIMIT) {
    sections.push(formatMemorySection('workspace_memory', memory.path, memory.content, memory.charCount, memory.charLimit));
  }
  return sections.length ? sections.join('\n\n') : null;
}
