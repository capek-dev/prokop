/**
 * Pure presentation helpers for the Branches tab: relative times, day groups,
 * sync wording, ref chips, and the row list the history rail renders.
 */
import type { GitBranchInfo, GitHistoryEntry } from '@prokopai/sdk';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Ahead/behind counts come from the last fetch; older than this they may mislead. */
export const FETCH_STALE_MS = HOUR;

function startOfDay(time: number): number {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

// toLocale*String builds a new Intl formatter per call, which costs most of a
// row render across hundreds of branches and commits; reuse one per style.
const SHORT_DATE = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const SHORT_DATE_WITH_YEAR = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const TIMESTAMP = new Intl.DateTimeFormat(undefined, {
  year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
});

function shortDate(time: number, now: number): string {
  const sameYear = new Date(time).getFullYear() === new Date(now).getFullYear();
  return (sameYear ? SHORT_DATE : SHORT_DATE_WITH_YEAR).format(time);
}

/** Full local date and time for tooltips, same output as `Date#toLocaleString()`. */
export function timestampLabel(iso: string): string {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? '' : TIMESTAMP.format(time);
}

/** Compact age for dense rows: "now", "5m", "2h", "3d", then a short date. */
export function relativeAge(iso: string, now: number): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return '';
  const elapsed = Math.max(0, now - time);
  if (elapsed < MINUTE) return 'now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)}d`;
  return shortDate(time, now);
}

/** Section heading for a commit date: "Today", "Yesterday", or a date. */
export function dayLabel(iso: string, now: number): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return 'Unknown date';
  const days = Math.round((startOfDay(now) - startOfDay(time)) / DAY);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return shortDate(time, now);
}

export function fetchedLabel(lastFetchedAt: string | null, now: number): string {
  if (!lastFetchedAt) return 'Never fetched';
  const age = relativeAge(lastFetchedAt, now);
  return age === 'now' ? 'Fetched just now' : /^\d/.test(age) ? `Fetched ${age} ago` : `Fetched ${age}`;
}

export function isFetchStale(lastFetchedAt: string | null, now: number): boolean {
  if (!lastFetchedAt) return true;
  return now - Date.parse(lastFetchedAt) > FETCH_STALE_MS;
}

export type BranchSync =
  | { kind: 'remote' }
  | { kind: 'unpublished' }
  | { kind: 'gone' }
  | { kind: 'up-to-date' }
  | { kind: 'ahead' | 'behind' | 'diverged'; ahead: number; behind: number };

/** Plain-language relationship between a branch and its upstream. */
export function branchSync(branch: GitBranchInfo): BranchSync {
  if (branch.kind === 'remote') return { kind: 'remote' };
  if (!branch.upstream) return { kind: 'unpublished' };
  if (branch.ahead === null || branch.behind === null) return { kind: 'gone' };
  const { ahead, behind } = branch;
  if (!ahead && !behind) return { kind: 'up-to-date' };
  return { kind: ahead && behind ? 'diverged' : ahead ? 'ahead' : 'behind', ahead, behind };
}

/** Short display name for a branch ref: "main", "origin/main". */
export function refLabel(ref: string): string {
  return ref.replace(/^refs\/(heads|remotes)\//, '');
}

/**
 * Branch chips per commit, most relevant first: the inspected branch, the
 * checked-out branch, the inspected branch's upstream, other local branches,
 * then other remote branches.
 */
export function refsByHead(branches: readonly GitBranchInfo[], selected: GitBranchInfo | undefined): Map<string, GitBranchInfo[]> {
  const rank = (branch: GitBranchInfo) => branch.ref === selected?.ref ? 0 : branch.current ? 1 : branch.ref === selected?.upstream ? 2 : branch.kind === 'local' ? 3 : 4;
  const byHead = new Map<string, GitBranchInfo[]>();
  for (const branch of [...branches].sort((a, b) => rank(a) - rank(b))) {
    const list = byHead.get(branch.head);
    if (list) list.push(branch);
    else byHead.set(branch.head, [branch]);
  }
  return byHead;
}

/** Newest local branches by head commit date, for the picker's Recent group. */
export function recentBranches(branches: readonly GitBranchInfo[], limit = 5): GitBranchInfo[] {
  return branches
    .filter((branch) => branch.kind === 'local' && branch.committedAt)
    .sort((a, b) => Date.parse(b.committedAt!) - Date.parse(a.committedAt!))
    .slice(0, limit);
}

export type HistoryRow =
  | { type: 'day'; key: string; label: string }
  | { type: 'upstream'; key: string; label: string }
  | { type: 'commit'; key: string; entry: GitHistoryEntry; first: boolean; last: boolean };

/**
 * Interleaves day headings and the upstream divider with commits. The divider
 * sits right above the commit the upstream points at, and only when newer
 * commits are listed above it (otherwise the upstream chip on the top row says it).
 */
export function buildHistoryRows(commits: readonly GitHistoryEntry[], now: number, upstream: { ref: string; head: string } | null, complete: boolean): HistoryRow[] {
  const rows: HistoryRow[] = [];
  let day: string | null = null;
  commits.forEach((entry, index) => {
    const label = dayLabel(entry.date, now);
    if (label !== day) {
      day = label;
      rows.push({ type: 'day', key: `day:${index}:${label}`, label });
    }
    if (upstream && index > 0 && entry.head === upstream.head) rows.push({ type: 'upstream', key: `upstream:${entry.head}`, label: refLabel(upstream.ref) });
    rows.push({ type: 'commit', key: entry.head, entry, first: index === 0, last: complete && index === commits.length - 1 });
  });
  return rows;
}
