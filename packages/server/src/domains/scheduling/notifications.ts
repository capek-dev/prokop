import type { ScheduledJob, Session } from '@jean2/sdk';

/**
 * Scheduling domain: scheduled-run notification policy.
 *
 * Owns the exact eligibility rules previously inlined in
 * `services/web-push/dispatch.ts`: ordinary sessions always notify, sessions
 * carrying a `metadata.scheduledJobId` notify only when the job record still
 * exists and opted in, and malformed scheduled-job ids fail closed. The
 * dispatch service supplies the job lookup; this module decides.
 */

export type ScheduledSessionOrigin =
  | { kind: 'none' }
  | { kind: 'malformed' }
  | { kind: 'job'; jobId: string };

export function scheduledSessionOrigin(session: Session | null | undefined): ScheduledSessionOrigin {
  const scheduledJobId = session?.metadata?.scheduledJobId;
  if (scheduledJobId === undefined || scheduledJobId === null) {
    return { kind: 'none' };
  }
  if (typeof scheduledJobId !== 'string' || scheduledJobId === '') {
    return { kind: 'malformed' };
  }
  return { kind: 'job', jobId: scheduledJobId };
}

/**
 * Whether a session is eligible for scheduled-event notifications.
 *
 * - Ordinary sessions (no `metadata.scheduledJobId`) are always eligible.
 * - Scheduled sessions are eligible only when their job exists and has
 *   `notificationsEnabled` set to true. A missing job record fails closed.
 */
export function canNotifyForSession(
  session: Session | null,
  getJob: (id: string) => ScheduledJob | null,
): boolean {
  if (!session) {
    return false;
  }

  const origin = scheduledSessionOrigin(session);
  if (origin.kind === 'none') {
    return true;
  }
  if (origin.kind === 'malformed') {
    return false;
  }

  return getJob(origin.jobId)?.notificationsEnabled === true;
}
