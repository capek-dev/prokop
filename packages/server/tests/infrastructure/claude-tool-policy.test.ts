import { expect, test } from 'bun:test';
import { classifyClaudeTool } from '@/harnesses/claude-cli/tool-policy';

const root = '/workspace';
const agent = '/data/agents/coder';
const allowed = { roots: [root, '/extra'], readRoots: [agent] };

test('allowed roots: additional paths read and write, agent directory reads only', () => {
  expect(classifyClaudeTool('Read', { file_path: `${agent}/skills/x/SKILL.md` }, root, allowed)).toBeUndefined();
  expect(classifyClaudeTool('Grep', { pattern: 'name', path: agent }, root, allowed)).toBeUndefined();
  expect(classifyClaudeTool('Bash', { command: `cat ${agent}/skills/x/SKILL.md` }, root, allowed)).toBeUndefined();
  expect(classifyClaudeTool('Write', { file_path: '/extra/notes.md', content: 'x' }, root, allowed)).toBeUndefined();
  expect(classifyClaudeTool('Write', { file_path: `${agent}/MEMORY.md`, content: 'x' }, root, allowed))
    .toMatchObject({ concerns: ['escape'] });
  expect(classifyClaudeTool('Read', { file_path: '/elsewhere/a.txt' }, root, allowed))
    .toMatchObject({ concerns: ['escape'] });
});

test('without session roots only the selected root is allowed', () => {
  expect(classifyClaudeTool('Read', { file_path: `${agent}/skills/x/SKILL.md` }, root))
    .toMatchObject({ concerns: ['escape'] });
});
