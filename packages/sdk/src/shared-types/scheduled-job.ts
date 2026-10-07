import type { AutoApproveSeverity } from './session';
import type { PermissionMode, SessionHarness } from './session';

export type ScheduleKind = 'once' | 'interval' | 'daily' | 'weekly';

export type ScheduledJobState = 'active' | 'paused' | 'completed';

export interface ScheduleConfigOnce {
  type: 'once';
  runAt: string;
}

export interface ScheduleConfigInterval {
  type: 'interval';
  intervalMinutes: number;
}

export interface ScheduleConfigDaily {
  type: 'daily';
  time: string;
}

export interface ScheduleConfigWeekly {
  type: 'weekly';
  days: number[];
  time: string;
}

export type ScheduleConfig =
  | ScheduleConfigOnce
  | ScheduleConfigInterval
  | ScheduleConfigDaily
  | ScheduleConfigWeekly;

export interface ScheduledJob {
  id: string;
  workspaceId: string;
  name: string;
  prompt: string;
  scheduleKind: ScheduleKind;
  scheduleConfig: ScheduleConfig;
  scheduleDisplay: string;
  state: ScheduledJobState;
  repeatLimit: number | null;
  runCount: number;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunSessionId: string | null;
  lastError: string | null;
  reuseSession: boolean;
  includeHistory: boolean;
  preconfigId: string | null;
  originSessionId: string | null;
  /** @deprecated Permissions-v2 jobs carry the host's own permission-mode
   * override; this legacy ladder is no longer read. */
  autoApproveSeverity?: AutoApproveSeverity | null;
  notificationsEnabled: boolean;
  createdAt: string;
  updatedAt: string;

  harness: SessionHarness;
  /** Optional permission-mode override; null uses the workspace default. */
  permissionMode?: PermissionMode | null;
}

export interface CreateScheduledJobInput {
  name: string;
  prompt: string;
  scheduleKind: ScheduleKind;
  scheduleConfig: ScheduleConfig;
  repeatLimit?: number | null;
  reuseSession?: boolean;
  includeHistory?: boolean;
  preconfigId?: string | null;
  originSessionId?: string | null;
  /** @deprecated See ScheduledJob.autoApproveSeverity. */
  autoApproveSeverity?: AutoApproveSeverity | null;
  notificationsEnabled?: boolean;

  /** Optional at creation; persisted as 'prokop' when omitted. Creation
   * rejects harnesses without a headless execution implementation. */
  harness?: SessionHarness;
  permissionMode?: PermissionMode | null;
}

export interface UpdateScheduledJobInput {
  name?: string;
  prompt?: string;
  scheduleKind?: ScheduleKind;
  scheduleConfig?: ScheduleConfig;
  repeatLimit?: number | null;
  reuseSession?: boolean;
  includeHistory?: boolean;
  preconfigId?: string | null;
  /** @deprecated See ScheduledJob.autoApproveSeverity. */
  autoApproveSeverity?: AutoApproveSeverity | null;
  state?: ScheduledJobState;
  notificationsEnabled?: boolean;

  permissionMode?: PermissionMode | null;
}
