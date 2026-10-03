import { describe, expect, test } from 'bun:test';
import { homedir } from 'node:os';
import { analyzeCommand, classifyShellCommand } from '@/domains/permissions';
import { classifyClaudeTool } from '@/harnesses/claude-cli/tool-policy';
import { classifyCodexHook, type CodexHookCall } from '@/harnesses/codex-cli/hook-policy';

const root = '/permission-fixture/project';
const context = { roots: [root], cwd: root, home: homedir() };
const allowed = { roots: context.roots, readRoots: [] };
const call: CodexHookCall = {
  session_id: 'thread', turn_id: 'turn', tool_use_id: 'item',
  hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd: root, tool_input: {},
};

describe('relative wildcard permission paths across harnesses', () => {
  test.each([
    ['cat src/*.ts', `${root}/src`],
    ['cat report*.txt', root],
    ['cat a?.txt', root],
    ['cat *.txt', root],
    ['cat ./src/*.ts', `${root}/src`],
    ['cat src/prefix*/file.ts', `${root}/src`],
    ['cd src && cat nested/*.ts', `${root}/src/nested`],
    ['/bin/zsh -lc "cat src/*.ts"', `${root}/src`],
    ["/bin/zsh -lc 'cat src/*.ts'", `${root}/src`],
  ])('%s resolves against command cwd', (command, expected) => {
    const finding = analyzeCommand(command, context);
    expect(finding.resolvedPaths).toContain(expected);
    expect(finding.concerns).not.toContain('escape');
    expect(classifyShellCommand(command, root, root)?.finding).toEqual(finding);
    expect(classifyClaudeTool('Bash', { command }, root, allowed)).toBeUndefined();
    expect(classifyCodexHook({ ...call, tool_input: { command } }, allowed)).toBeNull();
  });

  test('reported compound command keeps every path inside the workspace', () => {
    const command = "sed -n '75,120p' packages/server/src/harnesses/prokop/tools/shell/tool.ts; "
      + "sed -n '95,165p' packages/server/src/harnesses/prokop/tools/terminal/tool.ts; "
      + "sed -n '170,220p' packages/server/tests/domains/permissions-command-analyze.test.ts; "
      + "rg -n 'temp|TMPDIR|env|instruction' packages/server/src/harnesses/shared/*.ts | head -65; "
      + "sed -n '460,550p' packages/server/src/domains/permissions/command/analyze.ts";
    const finding = classifyShellCommand(command, root, root)!.finding;
    expect(finding.concerns).toEqual([]);
    expect(finding.evidence).toEqual([]);
    expect(finding.resolvedPaths).toContain(`${root}/packages/server/src/harnesses/shared`);
    expect(finding.resolvedPaths.every(path => path.startsWith(`${root}/`))).toBe(true);
    expect(classifyClaudeTool('Bash', { command }, root, allowed)).toBeUndefined();
    expect(classifyCodexHook({ ...call, tool_input: { command } }, allowed)).toBeNull();
  });

  test.each([
    ['cat ../outside/*.ts', '/permission-fixture/outside', 'escape'],
    ['cat /outside/*.ts', '/outside', 'escape'],
    ['cat ~/notes*.txt', homedir(), 'escape'],
    ['rm -rf src/*.ts', `${root}/src`, 'destructive'],
  ] as const)('%s preserves the concern and displayed path', (command, expected, concern) => {
    const prokop = classifyShellCommand(command, root, root)!;
    const claude = classifyClaudeTool('Bash', { command }, root, allowed);
    const codex = classifyCodexHook({ ...call, tool_input: { command } }, allowed);
    expect(prokop.finding.resolvedPaths).toContain(expected);
    expect(codex?.metadata?.resolvedPaths).toContain(expected);
    for (const ask of [prokop.ask, claude, codex]) {
      expect(ask?.concerns).toContain(concern);
      if (concern === 'escape') {
        expect(ask?.evidence).toContain(`path ${expected} is outside the allowed roots`);
      } else {
        expect(ask?.concerns).not.toContain('escape');
      }
    }
  });
});
