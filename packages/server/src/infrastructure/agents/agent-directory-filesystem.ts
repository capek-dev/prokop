import { mkdir, readFile, readdir, rm, stat, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import type { AgentDirectoryPort } from '@/application/ports/agents';

/**
 * Filesystem implementation of the agent directory port (S4/S5). Owns all
 * agent directory and memory file I/O; paths are supplied by the
 * application from the injected data-directory accessor, so this adapter
 * holds no configuration state.
 */
export function createAgentDirectoryPort(): AgentDirectoryPort {
  return {
    exists(path) {
      return existsSync(path);
    },

    async listDirectories(path) {
      const entries = await readdir(path, { withFileTypes: true });
      return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    },

    async statBirthtimeIso(path) {
      const stats = await stat(path);
      return stats.birthtime.toISOString();
    },

    async makeDirectories(...paths) {
      for (const path of paths) {
        await mkdir(path, { recursive: true });
      }
    },

    async removeRecursive(path) {
      await rm(path, { recursive: true, force: true });
    },

    async readFileOrNull(path) {
      try {
        return await readFile(path, 'utf-8');
      } catch {
        return null;
      }
    },

    async writeFile(path, content) {
      await writeFile(path, content, 'utf-8');
    },
  };
}
