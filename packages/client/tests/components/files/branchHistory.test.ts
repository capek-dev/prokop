import { describe, expect, test } from 'vitest';
import type { GitBranchInfo, GitHistoryEntry } from '@prokopai/sdk';
import { branchSync, buildHistoryRows, dayLabel, fetchedLabel, isFetchStale, recentBranches, refLabel, refsByHead, relativeAge, timestampLabel } from '@/components/files/branchHistory';

const now = new Date(2026, 9, 6, 12, 0, 0).getTime();
const ago = (ms: number) => new Date(now - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const branch = (name: string, patch: Partial<GitBranchInfo> = {}): GitBranchInfo => ({
  ref: `refs/heads/${name}`, name, head: 'a'.repeat(40), kind: 'local', current: false, checkedOut: false,
  upstream: null, ahead: null, behind: null, committedAt: null, ...patch,
});
const remote = (name: string, head = 'a'.repeat(40)) => branch(name, { ref: `refs/remotes/${name}`, kind: 'remote', head });
const commit = (head: string, date: string): GitHistoryEntry => ({ head, subject: head, author: 'Test', date, parents: [] });

describe('relativeAge', () => {
  test('compact units, then a short date after a week', () => {
    expect(relativeAge(ago(10_000), now)).toBe('now');
    expect(relativeAge(ago(5 * MIN), now)).toBe('5m');
    expect(relativeAge(ago(2 * HOUR), now)).toBe('2h');
    expect(relativeAge(ago(3 * DAY), now)).toBe('3d');
    expect(relativeAge(ago(10 * DAY), now)).not.toMatch(/^\d+[mhd]$/);
    expect(relativeAge('garbage', now)).toBe('');
  });
  test('future timestamps (clock skew) read as now', () => {
    expect(relativeAge(new Date(now + HOUR).toISOString(), now)).toBe('now');
  });
});

test('timestampLabel matches toLocaleString and tolerates bad input', () => {
  const iso = ago(3 * DAY);
  expect(timestampLabel(iso)).toBe(new Date(iso).toLocaleString());
  expect(timestampLabel('garbage')).toBe('');
});

describe('dayLabel', () => {
  test('today, yesterday, then a date', () => {
    expect(dayLabel(ago(HOUR), now)).toBe('Today');
    expect(dayLabel(ago(DAY), now)).toBe('Yesterday');
    expect(dayLabel(ago(5 * DAY), now)).not.toMatch(/Today|Yesterday/);
    expect(dayLabel('garbage', now)).toBe('Unknown date');
  });
});

describe('fetch freshness', () => {
  test('labels and staleness after one hour', () => {
    expect(fetchedLabel(null, now)).toBe('Never fetched');
    expect(fetchedLabel(ago(1000), now)).toBe('Fetched just now');
    expect(fetchedLabel(ago(12 * MIN), now)).toBe('Fetched 12m ago');
    expect(isFetchStale(null, now)).toBe(true);
    expect(isFetchStale(ago(30 * MIN), now)).toBe(false);
    expect(isFetchStale(ago(2 * HOUR), now)).toBe(true);
  });
});

describe('branchSync', () => {
  test('maps upstream state to plain-language kinds', () => {
    expect(branchSync(remote('origin/main'))).toEqual({ kind: 'remote' });
    expect(branchSync(branch('x'))).toEqual({ kind: 'unpublished' });
    expect(branchSync(branch('x', { upstream: 'refs/remotes/origin/x' }))).toEqual({ kind: 'gone' });
    const tracked = (ahead: number, behind: number) => branchSync(branch('x', { upstream: 'refs/remotes/origin/x', ahead, behind }));
    expect(tracked(0, 0)).toEqual({ kind: 'up-to-date' });
    expect(tracked(3, 0)).toEqual({ kind: 'ahead', ahead: 3, behind: 0 });
    expect(tracked(0, 1)).toEqual({ kind: 'behind', ahead: 0, behind: 1 });
    expect(tracked(2, 1)).toEqual({ kind: 'diverged', ahead: 2, behind: 1 });
  });

  test('a branch without upstream that exists on a remote is untracked, not unpublished', () => {
    const branches = [branch('feat/x'), remote('upstream/feat/x'), remote('origin/other')];
    expect(branchSync(branch('feat/x'), branches, ['origin', 'upstream'])).toEqual({ kind: 'untracked', remote: 'upstream', branch: 'feat/x' });
    expect(branchSync(branch('other'), branches, ['upstream'])).toEqual({ kind: 'unpublished' });
    expect(branchSync(branch('feat/x'), branches)).toEqual({ kind: 'unpublished' });
  });
});

test('refLabel strips heads and remotes prefixes', () => {
  expect(refLabel('refs/heads/feature/x')).toBe('feature/x');
  expect(refLabel('refs/remotes/origin/main')).toBe('origin/main');
});

test('refsByHead groups chips per commit with the inspected branch first', () => {
  const selected = branch('feature', { upstream: 'refs/remotes/origin/feature' });
  const current = branch('main', { current: true });
  const other = branch('other');
  const upstream = remote('origin/feature');
  const unrelated = remote('origin/zzz');
  const elsewhere = branch('elsewhere', { head: 'b'.repeat(40) });
  const map = refsByHead([unrelated, other, upstream, current, selected, elsewhere], selected);
  expect(map.get('a'.repeat(40))!.map((b) => b.name)).toEqual(['feature', 'main', 'origin/feature', 'other', 'origin/zzz']);
  expect(map.get('b'.repeat(40))!.map((b) => b.name)).toEqual(['elsewhere']);
});

test('recentBranches keeps the newest local branches with a commit date', () => {
  const list = [
    branch('old', { committedAt: ago(5 * DAY) }),
    branch('new', { committedAt: ago(HOUR) }),
    branch('undated'),
    remote('origin/newest'),
    branch('mid', { committedAt: ago(DAY) }),
  ];
  list[3] = { ...list[3], committedAt: ago(MIN) };
  expect(recentBranches(list).map((b) => b.name)).toEqual(['new', 'mid', 'old']);
  expect(recentBranches(list, 1).map((b) => b.name)).toEqual(['new']);
});

describe('buildHistoryRows', () => {
  const commits = [commit('c3', ago(HOUR)), commit('c2', ago(2 * HOUR)), commit('c1', ago(2 * DAY))];

  test('inserts day headings when the day changes and marks rail ends', () => {
    const rows = buildHistoryRows(commits, now, null, true);
    expect(rows.map((r) => r.type === 'commit' ? r.entry.head : `${r.type}:${r.label}`)).toEqual(['day:Today', 'c3', 'c2', `day:${dayLabel(commits[2].date, now)}`, 'c1']);
    const commitRows = rows.filter((r) => r.type === 'commit');
    expect(commitRows.map((r) => [r.first, r.last])).toEqual([[true, false], [false, false], [false, true]]);
  });

  test('more pages to load keep the rail open at the bottom', () => {
    const rows = buildHistoryRows(commits, now, null, false);
    expect(rows.filter((r) => r.type === 'commit').some((r) => r.last)).toBe(false);
  });

  test('upstream divider sits above its commit only when newer commits are listed', () => {
    const below = buildHistoryRows(commits, now, { ref: 'refs/remotes/origin/main', head: 'c2' }, true);
    const index = below.findIndex((r) => r.type === 'upstream');
    expect(below[index]).toMatchObject({ type: 'upstream', label: 'origin/main' });
    expect(below[index + 1]).toMatchObject({ type: 'commit', key: 'c2' });
    expect(buildHistoryRows(commits, now, { ref: 'refs/remotes/origin/main', head: 'c3' }, true).some((r) => r.type === 'upstream')).toBe(false);
  });
});
