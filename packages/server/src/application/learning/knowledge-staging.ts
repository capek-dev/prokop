export type KnowledgeMutator = <T>(kind: 'memory' | 'skills', execute: (directory: string) => Promise<T>) => Promise<T>;

export type KnowledgeSnapshot = ReadonlyMap<string, string>;

export interface KnowledgeStagingPort {
  /** Snapshot only allowed memory files or SKILL.md files, rejecting symlinks. */
  snapshot(kind: 'memory' | 'skills'): Promise<KnowledgeSnapshot>;
  create(kind: 'memory' | 'skills', initial: KnowledgeSnapshot): Promise<{
    directory: string;
    snapshot(): Promise<KnowledgeSnapshot>;
    dispose(): Promise<void>;
  }>;
  /** Apply a single-file change through the durable journal and protected CAS. */
  activate(kind: 'memory' | 'skills', path: string, before: string | null, after: string | null): Promise<void>;
}

/** Stage one tool operation. A failed tool result never activates partial files.
 * Reject multi-file mutations so an operation cannot become partially visible. */
export function createKnowledgeStagingMutator(
  port: KnowledgeStagingPort,
  authorize: () => Promise<void>,
): KnowledgeMutator {
  return async (kind, execute) => {
    await authorize();
    const before = await port.snapshot(kind);
    const stage = await port.create(kind, before);
    try {
      const result = await execute(stage.directory);
      await authorize();
      if (!result || typeof result !== 'object' || !('success' in result) || result.success !== true) return result;
      const after = await stage.snapshot();
      const paths = new Set([...before.keys(), ...after.keys()]);
      const changes = [...paths].filter(path => before.get(path) !== after.get(path));
      if (changes.length > 1) throw new Error('Learning operation modified multiple knowledge files');
      if (changes.length === 1) {
        await authorize();
        const path = changes[0]!;
        await port.activate(kind, path, before.get(path) ?? null, after.get(path) ?? null);
      }
      return result;
    } finally {
      await stage.dispose();
    }
  };
}
