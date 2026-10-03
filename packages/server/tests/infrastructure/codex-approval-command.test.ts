import { expect, test } from 'bun:test';
import { unwrapCodexApprovalCommand } from '@/harnesses/codex-cli/approval-command';

test('decodes one shell wrapper while preserving exact script contents', () => {
  for (const shell of ['/bin/zsh', '/bin/bash', '/usr/bin/bash', 'sh']) {
    for (const flag of ['-lc', '-c']) {
      expect(unwrapCodexApprovalCommand(`${shell} ${flag} 'rm -rf ./test'`)).toBe('rm -rf ./test');
    }
  }
  const script = `printf '%s' "$HOME" && rm -rf './a b'\necho done`;
  for (const escapedQuote of [`'\\''`, `'"'"'`]) {
    const quoted = `'${script.replaceAll("'", escapedQuote)}'`;
    expect(unwrapCodexApprovalCommand(`/bin/zsh -lc ${quoted}`)).toBe(script);
  }
  expect(unwrapCodexApprovalCommand('/bin/zsh -lc "rm -rf ./test"')).toBe('rm -rf ./test');
  expect(unwrapCodexApprovalCommand('/bin/zsh -lc "echo \\$HOME"')).toBe('echo $HOME');
  expect(unwrapCodexApprovalCommand("/bin/zsh -lc ' rm -rf ./test  '")).toBe(' rm -rf ./test  ');
});

test('rejects expansions, altered wrappers, malformed quoting and trailing commands', () => {
  for (const command of [
    'rm -rf ./test',
    "/tmp/zsh -lc 'rm -rf ./test'",
    "/bin/zsh -ilc 'rm -rf ./test'",
    "/bin/zsh -lc 'rm -rf ./test' extra",
    "/bin/zsh -lc 'rm -rf ./test'; echo extra",
    "/bin/zsh -lc 'rm -rf ./test'\necho extra",
    '/bin/zsh -lc "echo $HOME"',
    '/bin/zsh -lc "echo `pwd`"',
    "/bin/zsh -lc $(cat script)",
    "/bin/zsh -lc 'unfinished",
    '/bin/zsh -lc trailing\\',
    "/bin/zsh -lc 'nul\0'",
  ]) expect(unwrapCodexApprovalCommand(command)).toBeNull();
});
