import { z } from 'zod';
import type { LearningCadence, LearningScope, WorkspaceLearningSettings, WorkspaceSettings } from '@prokopai/sdk';

const identifier = z.string().trim().min(1).max(200);
const instructions = z.string().max(20_000);
const minutes = z.number().int().min(1).max(10_080);

export const learningCadenceSchema = z.object({
  idleMinutes: minutes,
  minimumIntervalMinutes: minutes,
  maximumPendingMinutes: minutes,
}).strict().refine(value => value.maximumPendingMinutes >= value.minimumIntervalMinutes, {
  message: 'Maximum pending time must not be shorter than the minimum review interval',
});

export const learningSettingsSchema = z.object({
  enabled: z.boolean(),
  reviewers: z.array(z.object({
    id: identifier,
    preconfigId: identifier,
    instructions: instructions.default(''),
    modelOverride: z.object({
      providerId: identifier,
      modelId: identifier,
      variant: identifier.nullable().optional(),
    }).strict().nullable().default(null),
    cadence: learningCadenceSchema.nullable().default(null),
  }).strict()).max(20),
  improveSkills: z.boolean().default(false),
  instructions: instructions.default(''),
  sources: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('all') }).strict(),
    z.object({
      mode: z.literal('selected'),
      workspaceIds: z.array(identifier).max(1000).refine(ids => new Set(ids).size === ids.length, {
        message: 'Source workspace IDs must be unique',
      }),
    }).strict(),
  ]).default({ mode: 'all' }),
}).strict().superRefine((value, context) => {
  if (value.enabled && value.reviewers.length === 0) {
    context.addIssue({ code: 'custom', path: ['reviewers'], message: 'Learning requires a reviewer' });
  }
  if (new Set(value.reviewers.map(reviewer => reviewer.id)).size !== value.reviewers.length) {
    context.addIssue({ code: 'custom', path: ['reviewers'], message: 'Reviewer IDs must be unique' });
  }
});

export const sessionLearningSettingsSchema = z.object({
  excluded: z.boolean().default(false),
  includeAutomated: z.boolean().default(false),
}).strict();

/** Read persisted or external settings without treating malformed input as enabled. */
export function parseLearningSettings(value: unknown): WorkspaceLearningSettings | null {
  const result = learningSettingsSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function defaultLearningCadence(scope: LearningScope): LearningCadence {
  return {
    idleMinutes: scope === 'workspace' ? 30 : 60,
    minimumIntervalMinutes: scope === 'workspace' ? 120 : 1440,
    maximumPendingMinutes: 1440,
  };
}

/** Explicit enable action only. Never changes existing permission risk settings. */
export function enableLearning(
  settings: WorkspaceSettings,
  preconfigId: string,
  reviewerId: string,
): WorkspaceSettings {
  const previous = parseLearningSettings(settings.learning);
  const ownerId = settings.isAgentHome ? settings.agentId : preconfigId;
  if (!ownerId?.trim()) throw new Error('Learning requires a valid reviewer identity');
  const reviewer = { id: reviewerId, preconfigId: ownerId, instructions: '', modelOverride: null, cadence: null };
  const reviewers = settings.isAgentHome
    ? [previous?.reviewers.find(item => item.preconfigId === ownerId) ?? reviewer]
    : previous?.reviewers.length ? previous.reviewers : [reviewer];
  const learning = learningSettingsSchema.parse({
    ...previous,
    enabled: true,
    reviewers,
    improveSkills: previous?.improveSkills ?? settings.skills?.managementEnabled === true,
  });
  return {
    ...settings,
    memory: { permissionRisk: 'low', ...settings.memory, enabled: true },
    sessionSearch: { permissionRisk: 'low', includeToolResults: false, ...settings.sessionSearch, enabled: true },
    learning,
  };
}

/** Do not silently restore dependencies the user explicitly disabled. */
export function enforceLearningDependencies(settings: WorkspaceSettings): WorkspaceSettings {
  if (!settings.learning?.enabled || (settings.memory?.enabled && settings.sessionSearch?.enabled)) {
    return settings;
  }
  return { ...settings, learning: { ...settings.learning, enabled: false } };
}
