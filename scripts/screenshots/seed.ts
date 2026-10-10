/**
 * Demo project setup: copies the fixture repo into the instance's fake home
 * and builds a short, plausible git history with fixed authors and dates.
 */
import { cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const FIXTURE = join(import.meta.dir, 'fixtures/demo-repo');

/** Commits replayed in order; each stages the listed paths. */
const HISTORY: Array<{ message: string; paths: string[]; date: string }> = [
  {
    message: 'Initial link store and redirect route',
    paths: ['package.json', 'tsconfig.json', 'README.md', 'src/store.ts', 'src/routes/redirect.ts', 'src/server.ts'],
    date: '2026-09-28T10:12:00+02:00',
  },
  {
    message: 'Add POST /api/links with url validation',
    paths: ['src/slug.ts', 'src/routes/links.ts', 'test/links.test.ts'],
    date: '2026-10-02T16:40:00+02:00',
  },
  {
    message: 'Cover redirects and click counting with tests',
    paths: ['test/redirect.test.ts'],
    date: '2026-10-07T09:05:00+02:00',
  },
];

export const DEMO_BRANCHES = ['feat/stats-expired-flag', 'feat/rate-limit', 'chore/build-script'] as const;

export const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: 'Maya Chen',
  GIT_AUTHOR_EMAIL: 'maya@linkshelf.dev',
  GIT_COMMITTER_NAME: 'Maya Chen',
  GIT_COMMITTER_EMAIL: 'maya@linkshelf.dev',
};

function git(cwd: string, args: string[], env: Record<string, string> = {}): void {
  const result = Bun.spawnSync(['git', ...args], {
    cwd,
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', ...GIT_IDENTITY, ...env },
  });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString()}`);
}

/** Creates `<home>/code/linkshelf` and returns its path. */
export function createDemoRepo(home: string): string {
  const repo = join(home, 'code', 'linkshelf');
  mkdirSync(repo, { recursive: true });
  cpSync(FIXTURE, repo, { recursive: true });

  git(repo, ['init', '--quiet', '--initial-branch=main']);
  for (const commit of HISTORY) {
    git(repo, ['add', ...commit.paths]);
    git(repo, ['commit', '--quiet', '--no-verify', '-m', commit.message], {
      GIT_AUTHOR_DATE: commit.date,
      GIT_COMMITTER_DATE: commit.date,
    });
  }
  // Worktrees check out an existing branch, so create them up front.
  for (const branch of DEMO_BRANCHES) git(repo, ['branch', branch]);
  return repo;
}
