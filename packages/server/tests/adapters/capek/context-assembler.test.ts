import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import type { ContextAssemblyData } from '@capekai/core/composition';
import type { SelectedContextRecord } from '@prokopai/sdk';
import { assembleSelectedContext, configureSelectedContext, type ContextSelectionDependencies } from '@/adapters/capek/context-assembler';
import { configureAgentSource } from '@capekai/core/hosts';
import { createRuntime, createJean2RuntimeComposition } from '@/bootstrap/create-runtime';

import type { ContextScore } from '@/application/context/selection';

const judgment = (score: number): ContextScore => ({ score, probabilities: [score === 0 ? 1 : 0, score === 1 ? 1 : 0, score === 2 ? 1 : 0, score === 3 ? 1 : 0] });

const data: ContextAssemblyData = {
  preconfig: { id: 'agent', name: 'Agent', description: '', systemPrompt: '', tools: null, model: null, provider: null, settings: null, isDefault: false },
  workspaceId: 'ws', workspacePath: '/workspace', assistantMessageId: 'response',
  selectionInput: { sessionId: 'session', request: { messageId: 'request', text: 'fix login', truncated: false }, recentMessages: [], continuation: false },
};
const sections = [
  { id: 'agent-memory', content: '<agent_memory>\n- selected\n- irrelevant\n</agent_memory>' },
  { id: 'agent-user-preferences', content: '<agent_user_preferences>\nAgent preference\n</agent_user_preferences>' },
  { id: 'system-prompt', content: 'System instructions' },
  { id: 'workspace-memory', content: '<user_memory path="USER.md" usage="10/1500">\nPreference\n</user_memory>\n\n<workspace_memory path="MEMORY.md" usage="10/2500">\n- workspace\n</workspace_memory>' },
];
const baseline = sections.map(section => section.content).join('\n\n');
function harness(overrides: Partial<ContextSelectionDependencies> = {}) {
  const records: SelectedContextRecord[] = [];
  const deps: ContextSelectionDependencies = {
    enabled: true, credentials: true, sections: async () => sections,
    skills: async () => [], score: async (_input, candidates) => candidates.map((_, i) => judgment(i === 0 ? 3 : 0)),
    save: record => { records.push(structuredClone(record)); }, ...overrides,
  };
  return { deps, records };
}

describe('request-local selected context', () => {
  let logs: ReturnType<typeof spyOn<typeof console, 'info'>>;
  beforeEach(() => { logs = spyOn(console, 'info').mockImplementation(() => {}); });
  afterEach(() => { logs.mockRestore(); });

  test('fallback honors a smaller budget across workspace and agent entries in source order', async () => {
    const { deps, records } = harness({ enabled: false, policy: { threshold: 2, requiredProbability: 0.7, memoryChars: 20, skillChars: 0 } });
    await assembleSelectedContext(data, deps);
    expect(records[0].items.filter(item => item.kind === 'memory').map(item => item.content)).toEqual(['- selected']);
    expect(records[0].items.filter(item => item.kind === 'preferences')).toHaveLength(2);
  });

  test('large memory fallback keeps whole entries and preferences without exposing the full file', async () => {
    const largeSections = [sections[1], { id: 'agent-memory', content: `<agent_memory>\n- keep\n- ${'x'.repeat(49000)}\n</agent_memory>` }];
    for (const overrides of [
      { enabled: false }, { credentials: false },
      { score: async () => { throw new Error('offline'); } },
      { timeoutMs: 1, score: async () => new Promise<ContextScore[]>(() => {}) },
      { skills: async () => Array.from({ length: 257 }, () => ({ name: 's', description: '', content: '', location: '/s' })) },
    ]) {
      const { deps, records } = harness({ sections: async () => largeSections, ...overrides });
      const prompt = await assembleSelectedContext(data, deps);
      expect(prompt).toContain('- keep');
      expect(prompt).toContain('Agent preference');
      expect(prompt).not.toContain('xxx');
      expect(records[0].items.filter(item => item.kind === 'memory').map(item => item.content)).toEqual(['- keep']);
      expect(await assembleSelectedContext({ ...data, assistantMessageId: undefined }, deps)).not.toContain('xxx');
    }
  });

  test('diagnostics distinguish absent memories from threshold exclusions', async () => {
    const { deps } = harness();
    await assembleSelectedContext(data, deps);
    const assembly = JSON.parse(logs.mock.calls[0][1]);
    expect(assembly.memoryCandidates.map((item: { source: string }) => item.source)).toEqual(['agent', 'agent', 'workspace']);
    const outcome = JSON.parse(logs.mock.calls[1][1]);
    expect(outcome.outcome).toBe('selected');
    expect(outcome.excluded.map((item: { reason: string }) => item.reason)).toEqual(['threshold', 'threshold']);
    expect(JSON.stringify(logs.mock.calls)).not.toContain('Agent preference');

    logs.mockClear();
    await assembleSelectedContext(data, harness({ sections: async () => [] }).deps);
    expect(JSON.parse(logs.mock.calls[0][1]).memoryCandidates).toEqual([]);
  });

  test('diagnostics explain selection skipped before scoring', async () => {
    const { deps } = harness();
    expect(await assembleSelectedContext({ ...data, assistantMessageId: undefined }, deps)).toBe(baseline);
    expect(JSON.parse(logs.mock.calls[0][1]).reason).toBe('missing_assembly_metadata');
  });
  test('the composed published assembler filters actual memory-domain sections', async () => {
    createRuntime();
    configureAgentSource({ getDirectory: async () => '/test-agent', readMemoryFile: async (_id, name) => name === 'MEMORY.md' ? '- useful\n- unrelated' : 'Always preserved' });
    const records: SelectedContextRecord[] = [];
    configureSelectedContext(() => ({ enabled: true, credentials: true,
      score: async (_input, candidates) => candidates.map(item => judgment(item.content === '- useful' ? 3 : 0)),
      save: record => { records.push(record); },
    }));
    const composition = await createJean2RuntimeComposition();
    try {
      const prompt = await composition.buildContext({ ...data, workspaceId: undefined, workspacePath: undefined });
      expect(prompt).toContain('<agent_memory>\n- useful\n</agent_memory>');
      expect(prompt).not.toContain('- unrelated');
      expect(prompt).toContain('<agent_user_preferences>\nAlways preserved\n</agent_user_preferences>');
      expect(records[0].outcome).toBe('selected');
    } finally {
      await composition.agentScope.dispose();
      await composition.processScope.dispose();
      createRuntime();
    }
  });
  test('preserves literal replacement tokens in selected entries', async () => {
    const content = '<agent_memory>\n- literal $& $$ $`\n</agent_memory>';
    const { deps } = harness({ sections: async () => [{ id: 'agent-memory', content }] });
    expect(await assembleSelectedContext(data, deps)).toBe(content);
  });
  test('scoring capacity counts content once instead of duplicate local snapshot fields', async () => {
    let called = false;
    const { deps, records } = harness({
      skills: async () => [{ name: 'large', description: 'large', content: 'x'.repeat(140000), location: '/workspace/.agents/skills/large/SKILL.md' }],
      score: async (_input, candidates) => { called = true; return candidates.map(() => judgment(0)); },
    });
    await assembleSelectedContext(data, deps);
    expect(called).toBe(true);
    expect(records[0].outcome).toBe('selected');
  });

  test('limit diagnostics distinguish candidate count from serialized scoring size', async () => {
    for (const [count, content, reason] of [[257, '', 'candidate_count'], [1, '"'.repeat(130000), 'scoring_state']] as const) {
      let called = false;
      const { deps, records } = harness({
        skills: async () => Array.from({ length: count }, (_, index) => ({ name: `skill-${index}`, description: '', content, location: `/skills/${index}` })),
        score: async () => { called = true; return []; },
      });
      await assembleSelectedContext(data, deps);
      expect(called).toBe(false);
      expect(records[0].outcome).toBe('input_limit');
      const log = [...logs.mock.calls].reverse().find(call => call[0] === '[context-selection] input-limit');
      expect(JSON.parse(log![1]).reason).toBe(reason);
      expect(JSON.parse(log![1]).candidateCount).toBe(count + 3);
    }
  });

  test('oversized candidates never reach the relevance service', async () => {
    let called = false;
    const { deps, records } = harness({
      skills: async () => [{ name: 'large', description: 'large', content: 'x'.repeat(256001), location: '/workspace/.agents/skills/large/SKILL.md' }],
      score: async () => { called = true; return []; },
    });
    expect(await assembleSelectedContext(data, deps)).toBe(baseline);
    expect(called).toBe(false);
    expect(records[0].outcome).toBe('input_limit');
  });
  test('concurrent calls preserve their own workspace and request snapshots', async () => {
    const { deps, records } = harness({
      sections: async value => [{ id: 'agent-memory', content: `<agent_memory>\n- ${value.workspacePath}\n</agent_memory>` }],
      score: async (input, candidates) => {
        await new Promise(resolve => setTimeout(resolve, input.sessionId === 'session' ? 5 : 0));
        return candidates.map(candidate => judgment(candidate.content.includes(input.request!.text) ? 3 : 0));
      },
    });
    const makeData = (id: string, path: string): ContextAssemblyData => ({ ...data, workspacePath: path, assistantMessageId: id,
      selectionInput: { ...data.selectionInput!, sessionId: id, request: { messageId: id, text: path, truncated: false } },
    });
    const prompts = await Promise.all([assembleSelectedContext(makeData('session', '/first'), deps), assembleSelectedContext(makeData('other', '/second'), deps)]);
    expect(prompts[0]).not.toContain('/second');
    expect(prompts[1]).not.toContain('/first');
    expect(records.find(record => record.sessionId === 'session')?.items[0].content).toBe('- /first');
    expect(records.find(record => record.sessionId === 'other')?.items[0].content).toBe('- /second');
  });
  test('probability policy changes qualification and snapshot without changing budgets', async () => {
    const { deps, records } = harness({ score: async (_input, candidates) => candidates.map(() => ({ score: 1.7, probabilities: [0, 0.3, 0.7, 0] })) });
    expect(await assembleSelectedContext(data, deps)).toContain('- selected');
    expect(records[0].requiredProbability).toBe(0.7);
    expect(records[0].items.find(item => item.kind === 'memory')?.qualifyingProbability).toBe(0.7);
    deps.policy = { threshold: 2, requiredProbability: 0.8, memoryChars: 5000, skillChars: 24000 };
    expect(await assembleSelectedContext(data, deps)).not.toContain('- selected');
    expect(records[1].excluded[0].qualifyingProbability).toBe(0.7);
    expect(records[0].requiredProbability).toBe(0.7);
  });

  test('filters ordinary memory while retaining both preferences and system instructions', async () => {
    const { deps, records } = harness();
    const prompt = await assembleSelectedContext(data, deps);
    expect(prompt).toContain('- selected');
    expect(prompt).not.toContain('- irrelevant');
    expect(prompt).not.toContain('- workspace');
    expect(prompt).toContain(sections[1].content);
    expect(prompt).toContain('Preference');
    expect(prompt).toContain('System instructions');
    expect(records[0].items.map(item => item.inclusion)).toEqual(['always', 'always', 'selected']);
    expect(records[0].assistantMessageId).toBe('response');
  });
  test('disabled and unavailable selection preserve baseline bytes', async () => {
    for (const [overrides, outcome] of [
      [{ enabled: false }, 'disabled'], [{ credentials: false }, 'missing_credentials'],
      [{ score: async () => { throw new Error('failure'); } }, 'failed'],
      [{ score: async () => [judgment(NaN)] }, 'failed'],
    ] as const) {
      const { deps, records } = harness(overrides);
      expect(await assembleSelectedContext(data, deps)).toBe(baseline);
      expect(records[0].outcome).toBe(outcome);
      expect(JSON.parse(logs.mock.calls.at(-1)![1]).outcome).toBe(outcome);
    }
  });
  test('empty selection is successful, not fallback; workspace gate is not reloaded', async () => {
    const { deps, records } = harness({ sections: async () => sections.slice(0, 3), score: async (_i, c) => c.map(() => judgment(0)) });
    const prompt = await assembleSelectedContext(data, deps);
    expect(prompt).not.toContain('workspace_memory');
    expect(prompt).not.toContain('- selected');
    expect(records[0].outcome).toBe('selected');
    expect(records[0].items.every(item => item.kind === 'preferences')).toBe(true);
  });
  test('unknown memory format stays intact rather than discarding text', async () => {
    const { deps, records } = harness({ sections: async () => [{ id: 'agent-memory', content: 'future wrapper' }] });
    expect(await assembleSelectedContext(data, deps)).toBe('future wrapper');
    expect(records[0].items[0].inclusion).toBe('baseline');
  });
  test('timeout returns promptly; late scorer cannot mutate the saved snapshot', async () => {
    let finish!: (scores: ContextScore[]) => void;
    const { deps, records } = harness({ timeoutMs: 5, score: () => new Promise(resolve => { finish = resolve; }) });
    expect(await assembleSelectedContext(data, deps)).toBe(baseline);
    expect(records[0].outcome).toBe('timeout');
    finish([3, 3, 3].map(judgment));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(records).toHaveLength(1);
    expect(records[0].outcome).toBe('timeout');
  });
  test('user cancellation aborts without saving a response record', async () => {
    const controller = new AbortController();
    const { deps, records } = harness({ score: async () => { controller.abort(new Error('user cancelled')); return []; } });
    await expect(assembleSelectedContext({ ...data, signal: controller.signal }, deps)).rejects.toThrow('user cancelled');
    expect(records).toHaveLength(0);
  });
  test('attachment-only input falls back; continuation checkpoint is independent', async () => {
    const { deps, records } = harness();
    const input = { ...data.selectionInput!, request: { messageId: 'attachment', text: '', truncated: false } };
    expect(await assembleSelectedContext({ ...data, selectionInput: input }, deps)).toBe(baseline);
    expect(records[0].outcome).toBe('missing_evidence');
    await assembleSelectedContext({ ...data, assistantMessageId: 'continuation', selectionInput: {
      ...input, continuation: true, checkpoint: { messageId: 'checkpoint', text: 'continue login fix', truncated: false },
    } }, deps);
    expect(records[1].outcome).toBe('selected');
    expect(records[1].checkpointMessageId).toBe('checkpoint');
  });
  test('skill snapshots have exact rendered bodies and source labels', async () => {
    const { deps, records } = harness({ skills: async () => [
      { name: 'workspace-skill', description: 'local', content: 'workspace procedure', location: '/workspace/.agents/skills/local/SKILL.md' },
      { name: 'agent-skill', description: 'personal', content: 'agent procedure', location: '/agent/skills/personal/SKILL.md' },
    ], score: async (_i, c) => c.map(() => judgment(3)) });
    const prompt = await assembleSelectedContext(data, deps);
    const skills = records[0].items.filter(item => item.kind === 'skill');
    expect(skills.map(item => item.source)).toEqual(['agent', 'workspace']);
    for (const skill of skills) expect(prompt).toContain(skill.content);
  });
});
