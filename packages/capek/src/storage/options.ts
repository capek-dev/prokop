import type { ConversationStore, StorageBundle } from './contracts';
import { createInMemoryStorageBundle } from './memory';

export type AgentStorageOption =
  | ConversationStore
  | { type: 'memory' }
  | { type: 'sqlite'; path: string };

export interface AgentStorageComposition {
  storage: StorageBundle;
  close(): void;
}

function composeConversationStore(conversation: ConversationStore): StorageBundle {
  return {
    ...createInMemoryStorageBundle(),
    conversation,
  };
}

function isStorageDescriptor(
  option: AgentStorageOption,
): option is { type: 'memory' } | { type: 'sqlite'; path: string } {
  const record = option as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return (record.type === 'memory' && keys.length === 1)
    || (record.type === 'sqlite'
      && typeof record.path === 'string'
      && keys.length === 2
      && keys[0] === 'path'
      && keys[1] === 'type');
}

function memoryComposition(): AgentStorageComposition {
  return {
    storage: createInMemoryStorageBundle(),
    close: () => {},
  };
}

/** The sqlite driver is imported dynamically: importing the package entry
 * must not pull bun:sqlite into runtimes that only use memory or custom
 * stores. The driver loads only when { type: 'sqlite' } is requested. */
export async function createAgentStorage(option?: AgentStorageOption): Promise<AgentStorageComposition> {
  if (!option) {
    return memoryComposition();
  }

  if (isStorageDescriptor(option)) {
    if (option.type === 'memory') {
      return memoryComposition();
    }
    const [{ createSqliteConversationStore }, { createSqliteToolOutputArtifactStore }] = await Promise.all([
      import('./sqlite'),
      import('./sqlite-tool-output-artifacts'),
    ]);
    const conversation = createSqliteConversationStore({ path: option.path });
    const toolOutputArtifacts = createSqliteToolOutputArtifactStore({ path: option.path });
    return {
      storage: {
        ...composeConversationStore(conversation),
        toolOutputArtifacts,
      },
      close: () => {
        toolOutputArtifacts.close();
        conversation.close();
      },
    };
  }

  return {
    storage: composeConversationStore(option),
    close: () => {},
  };
}
