import type { ConversationStore, StorageBundle } from './contracts';
import { createInMemoryStorageBundle } from './memory';
import { createSqliteConversationStore } from './sqlite';
import { createSqliteToolOutputArtifactStore } from './tool-output-artifacts';

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

export function createAgentStorage(option?: AgentStorageOption): AgentStorageComposition {
  if (!option) {
    return {
      storage: createInMemoryStorageBundle(),
      close: () => {},
    };
  }

  if (isStorageDescriptor(option)) {
    if (option.type === 'memory') {
      return {
        storage: createInMemoryStorageBundle(),
        close: () => {},
      };
    }
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
