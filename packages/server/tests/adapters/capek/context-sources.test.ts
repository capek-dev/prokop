import { describe, expect, test } from 'bun:test';
import {
  jean2AgentSource,
  jean2InstructionSource,
  jean2PreconfigSource,
} from '@/adapters/capek/context-sources';
import { getAgentDirectory, getPreconfigOrAgent } from '@/agents/storage';
import { readAgentMemoryFile } from '@/agents/memory';
import {
  getDefaultPreconfig,
  getPreconfig,
  listPreconfigs,
  listSubagentPreconfigs,
} from '@/core/preconfig';
import { getGlobalAgentsPath } from '@/paths';

describe('Čapek context source adapters', () => {
  test('preconfig source wraps the exact preconfig operations', () => {
    expect(Object.keys(jean2PreconfigSource).sort()).toEqual(
      ['get', 'getDefault', 'getForAgent', 'list', 'listSubagents'].sort(),
    );
    expect(jean2PreconfigSource.get).toBe(getPreconfig);
    expect(jean2PreconfigSource.getDefault).toBe(getDefaultPreconfig);
    expect(jean2PreconfigSource.getForAgent).toBe(getPreconfigOrAgent);
    expect(jean2PreconfigSource.list).toBe(listPreconfigs);
    expect(jean2PreconfigSource.listSubagents).toBe(listSubagentPreconfigs);
  });

  test('agent source wraps the exact agent operations', () => {
    expect(Object.keys(jean2AgentSource).sort()).toEqual(['getDirectory', 'readMemoryFile'].sort());
    expect(jean2AgentSource.getDirectory).toBe(getAgentDirectory);
    expect(jean2AgentSource.readMemoryFile).toBe(readAgentMemoryFile);
  });

  test('instruction source wraps the exact global path operation', () => {
    expect(Object.keys(jean2InstructionSource)).toEqual(['getGlobalPath']);
    expect(jean2InstructionSource.getGlobalPath).toBe(getGlobalAgentsPath);
  });
});
