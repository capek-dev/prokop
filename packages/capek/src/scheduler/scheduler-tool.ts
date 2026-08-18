import type { PermissionAsk } from '@capekai/tool'
import type { PermissionRiskLevel } from '@capekai/tool'
import type { ScheduleConfig, ScheduleKind, ScheduledJob, UpdateScheduledJobInput } from '@capekai/types';
import { getSchedulerHost, type SchedulerHost } from './host';

export const schedulerToolDefinition = {
  name: 'scheduler',
  description: `Manage scheduled tasks for the current workspace. Create recurring or one-shot automated tasks that run as agent sessions on a schedule. Each run creates a new session (or reuses one) with the given prompt.

Actions:
- "create": Create a new scheduled job. Requires name, prompt, and schedule.
- "list": List all scheduled jobs in the workspace.
- "update": Update an existing job by ID. All fields optional except jobId.
- "pause": Pause a job (stops scheduling, keeps the job).
- "resume": Resume a paused job.
- "trigger": Run a job immediately (does not affect the schedule).
- "remove": Permanently delete a job.

Schedule types (convert the user's natural language to these):
- { type: "once", runAt: "2025-01-15T14:30:00.000Z" } — one-shot at an ISO timestamp
- { type: "interval", intervalMinutes: 120 } — recurring every N minutes
- { type: "daily", time: "09:00" } — daily at a specific time (HH:mm, server timezone)
- { type: "weekly", days: [1,2,3,4,5], time: "17:00" } — on specific weekdays (0=Sun, 1=Mon, ..., 6=Sat) at a time

Examples:
- "every 2 hours" → { type: "interval", intervalMinutes: 120 }
- "daily at 9am" → { type: "daily", time: "09:00" }
- "every weekday at 5pm" → { type: "weekly", days: [1,2,3,4,5], time: "17:00" }
- "in 30 minutes" → { type: "once", runAt: "<ISO timestamp 30 min from now>" }

The prompt should be self-contained — it is the full instruction given to the agent for each run.`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      action: { type: 'string' as const, enum: ['create', 'list', 'update', 'pause', 'resume', 'trigger', 'remove'], description: 'The action to perform.' },
      jobId: { type: 'string' as const, description: 'Job ID (for update/pause/resume/trigger/remove actions). Use "list" to find job IDs.' },
      name: { type: 'string' as const, description: 'Friendly name for the job (create/update).' },
      prompt: { type: 'string' as const, description: 'The task instruction to run on each execution (create/update). Must be self-contained.' },
      schedule: { type: 'object' as const, description: 'Schedule configuration (create/update). See tool description for format.', properties: { type: { type: 'string' as const, enum: ['once', 'interval', 'daily', 'weekly'] }, runAt: { type: 'string' as const, description: 'ISO timestamp (for type: "once")' }, intervalMinutes: { type: 'number' as const, description: 'Minutes between runs (for type: "interval")' }, time: { type: 'string' as const, description: 'HH:mm time (for type: "daily" or "weekly")' }, days: { type: 'array' as const, items: { type: 'number' as const }, description: 'Weekdays 0-6 (0=Sun) for type: "weekly"' } } },
      repeatLimit: { type: 'number' as const, description: 'Maximum number of runs. Omit for infinite. (create/update)' },
      reuseSession: { type: 'boolean' as const, description: 'If true, all runs accumulate in the same session. If false (default), each run creates a new session.' },
      includeHistory: { type: 'boolean' as const, description: 'When reuseSession is true, whether the agent sees previous run history. Default false.' },
      autoApproveSeverity: { type: 'string' as const, enum: ['off', 'none', 'low', 'medium', 'high'], description: 'Auto-approve severity for sessions created by this job. Omit or null to use workspace default.' },
      notificationsEnabled: { type: 'boolean' as const, description: 'When true, scheduled runs may send completion, failure, and permission push notifications (subject to each browser subscription\'s existing preferences). Defaults to false (no notifications). (create/update)' },
    }, required: ['action'],
  }, timeout: 10000,
};
export interface SchedulerToolResult { success: boolean; action: string; title: string; job?: ScheduledJob; jobs?: ScheduledJob[]; jobId?: string; error?: string }

function parseSchedule(raw: Record<string, unknown>): { kind: ScheduleKind; config: ScheduleConfig } | { error: string } {
  const type = raw.type as string;
  if (!type) return { error: 'Schedule type is required' };
  if (type === 'once') {
    const runAt = raw.runAt as string;
    if (!runAt) return { error: 'runAt (ISO timestamp) is required for type "once"' };
    const timestamp = new Date(runAt).getTime();
    return Number.isFinite(timestamp) ? { kind: 'once', config: { type: 'once', runAt: new Date(timestamp).toISOString() } } : { error: `Invalid runAt timestamp: ${runAt}` };
  }
  if (type === 'interval') {
    const minutes = raw.intervalMinutes as number;
    return minutes && minutes >= 1 ? { kind: 'interval', config: { type: 'interval', intervalMinutes: minutes } } : { error: 'intervalMinutes must be a positive number' };
  }
  if (type === 'daily') {
    const time = raw.time as string;
    return time && /^\d{2}:\d{2}$/.test(time) ? { kind: 'daily', config: { type: 'daily', time } } : { error: 'time must be in HH:mm format for type "daily"' };
  }
  if (type === 'weekly') {
    const time = raw.time as string;
    const days = raw.days as number[];
    if (!time || !/^\d{2}:\d{2}$/.test(time)) return { error: 'time must be in HH:mm format for type "weekly"' };
    if (!Array.isArray(days) || days.length === 0) return { error: 'days array is required for type "weekly"' };
    const valid = days.filter((day) => typeof day === 'number' && day >= 0 && day <= 6);
    return valid.length > 0 ? { kind: 'weekly', config: { type: 'weekly', days: valid, time } } : { error: 'days must contain valid weekday numbers (0-6)' };
  }
  return { error: `Unknown schedule type: ${type}` };
}

/** Unscoped execution path: reads the configured module-level host, exactly
 * like the pre-C5 tool. */
export async function executeSchedulerTool(input: Record<string, unknown>, workspaceId: string, currentSessionId: string, risk: PermissionRiskLevel, askFn?: (ask: PermissionAsk) => Promise<unknown>): Promise<SchedulerToolResult> {
  return runScheduler(getSchedulerHost(), input, workspaceId, currentSessionId, risk, askFn);
}

/** Composed execution path: the domain plugin captures the process-scoped
 * host service at setup and passes it here, so composed execution never
 * reads the mutable module-global host accessor. */
export async function executeSchedulerToolWithHost(host: SchedulerHost, input: Record<string, unknown>, workspaceId: string, currentSessionId: string, risk: PermissionRiskLevel, askFn?: (ask: PermissionAsk) => Promise<unknown>): Promise<SchedulerToolResult> {
  return runScheduler(host, input, workspaceId, currentSessionId, risk, askFn);
}

async function runScheduler(host: SchedulerHost, input: Record<string, unknown>, workspaceId: string, currentSessionId: string, risk: PermissionRiskLevel, askFn?: (ask: PermissionAsk) => Promise<unknown>): Promise<SchedulerToolResult> {
  const action = input.action as string;
  if (action !== 'list' && risk !== 'none' && askFn) {
    const verb = ({ create: 'create', update: 'update', pause: 'pause', resume: 'resume', trigger: 'trigger', remove: 'delete' } as Record<string, string>)[action] || action;
    const name = (input.name as string) || (input.jobId as string) || '';
    console.log(`[scheduler-tool] Requesting permission for "${verb}"...`);
    const approved = await askFn({ type: 'permission', question: name ? `Allow scheduler to ${verb} scheduled job "${name.slice(0, 80)}"?` : `Allow scheduler to ${verb} a scheduled job?`, description: `Tool: scheduler\nAction: ${verb}${name ? `\nJob: ${name.slice(0, 200)}` : ''}`, risk, resource: 'scheduler', action: verb });
    if (!approved) return { success: false, action, title: 'Permission denied', error: 'USER_REJECTION' };
  }
  try {
    switch (action) {
      case 'create': return create(input, workspaceId, currentSessionId, host);
      case 'list': { const jobs = host.list(workspaceId); return { success: true, action, title: `${jobs.length} scheduled job${jobs.length === 1 ? '' : 's'}`, jobs }; }
      case 'update': return update(input, workspaceId, host);
      case 'pause': return stateChange(input, workspaceId, 'paused', host);
      case 'resume': return stateChange(input, workspaceId, 'active', host);
      case 'trigger': return trigger(input, workspaceId, host);
      case 'remove': return remove(input, workspaceId, host);
      default: return { success: false, action, title: 'Invalid action', error: `Unknown action: ${action}` };
    }
  } catch (error: unknown) {
    console.error(`[scheduler-tool] Action "${action}" failed:`, error);
    return { success: false, action, title: 'Internal error', error: error instanceof Error ? error.message : String(error) };
  }
}

function create(input: Record<string, unknown>, workspaceId: string, sessionId: string, host: SchedulerHost): SchedulerToolResult {
  const name = input.name as string;
  const prompt = input.prompt as string;
  const schedule = input.schedule as Record<string, unknown>;
  if (!name || typeof name !== 'string' || name.trim() === '') return { success: false, action: 'create', title: 'Validation error', error: 'name is required' };
  if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') return { success: false, action: 'create', title: 'Validation error', error: 'prompt is required' };
  if (!schedule || typeof schedule !== 'object') return { success: false, action: 'create', title: 'Validation error', error: 'schedule is required' };
  const parsed = parseSchedule(schedule);
  if ('error' in parsed) return { success: false, action: 'create', title: 'Validation error', error: parsed.error };
  const job = host.create(workspaceId, { name: name.trim(), prompt: prompt.trim(), scheduleKind: parsed.kind, scheduleConfig: parsed.config, repeatLimit: input.repeatLimit as number | null | undefined, reuseSession: input.reuseSession as boolean | undefined, includeHistory: input.includeHistory as boolean | undefined, originSessionId: sessionId, autoApproveSeverity: input.autoApproveSeverity as ScheduledJob['autoApproveSeverity'], notificationsEnabled: input.notificationsEnabled as boolean | undefined });
  return { success: true, action: 'create', title: `Scheduled job "${job.name}" created`, job };
}
function wrongWorkspace(job: ScheduledJob, workspaceId: string, action: string): SchedulerToolResult | null {
  return job.workspaceId === workspaceId
    ? null
    : { success: false, action, title: 'Access denied', error: 'Job does not belong to this workspace' };
}

function update(input: Record<string, unknown>, workspaceId: string, host: SchedulerHost): SchedulerToolResult {
  const id = input.jobId as string;
  if (!id) return { success: false, action: 'update', title: 'Validation error', error: 'jobId is required' };
  const existing = host.get(id);
  if (!existing) return { success: false, action: 'update', title: 'Not found', error: `Job ${id} not found` };
  const denied = wrongWorkspace(existing, workspaceId, 'update');
  if (denied) return denied;
  const updates: UpdateScheduledJobInput = {};
  for (const key of ['name', 'prompt', 'repeatLimit', 'reuseSession', 'includeHistory', 'autoApproveSeverity', 'notificationsEnabled'] as const) if (input[key] !== undefined) Object.assign(updates, { [key]: input[key] });
  if (input.schedule) {
    const parsed = parseSchedule(input.schedule as Record<string, unknown>);
    if ('error' in parsed) return { success: false, action: 'update', title: 'Validation error', error: parsed.error };
    updates.scheduleKind = parsed.kind; updates.scheduleConfig = parsed.config;
  }
  const job = host.update(id, updates);
  return job ? { success: true, action: 'update', title: `Scheduled job "${job.name}" updated`, job } : { success: false, action: 'update', title: 'Update failed', error: 'Failed to update job' };
}
function stateChange(input: Record<string, unknown>, workspaceId: string, state: 'active' | 'paused', host: SchedulerHost): SchedulerToolResult {
  const id = input.jobId as string; const action = input.action as string;
  if (!id) return { success: false, action, title: 'Validation error', error: 'jobId is required' };
  const existing = host.get(id); if (!existing) return { success: false, action, title: 'Not found', error: `Job ${id} not found` };
  const denied = wrongWorkspace(existing, workspaceId, action); if (denied) return denied;
  return { success: true, action, title: `Job "${existing.name}" ${state === 'paused' ? 'paused' : 'resumed'}`, job: host.update(id, { state }) ?? undefined };
}
function trigger(input: Record<string, unknown>, workspaceId: string, host: SchedulerHost): SchedulerToolResult {
  const id = input.jobId as string;
  if (!id) return { success: false, action: 'trigger', title: 'Validation error', error: 'jobId is required' };
  const job = host.get(id); if (!job) return { success: false, action: 'trigger', title: 'Not found', error: `Job ${id} not found` };
  const denied = wrongWorkspace(job, workspaceId, 'trigger'); if (denied) return denied;
  host.trigger(job); return { success: true, action: 'trigger', title: `Job "${job.name}" triggered`, jobId: id };
}
function remove(input: Record<string, unknown>, workspaceId: string, host: SchedulerHost): SchedulerToolResult {
  const id = input.jobId as string;
  if (!id) return { success: false, action: 'remove', title: 'Validation error', error: 'jobId is required' };
  const job = host.get(id); if (!job) return { success: false, action: 'remove', title: 'Not found', error: `Job ${id} not found` };
  const denied = wrongWorkspace(job, workspaceId, 'remove'); if (denied) return denied;
  host.delete(id); return { success: true, action: 'remove', title: `Job "${job.name}" deleted`, jobId: id };
}
