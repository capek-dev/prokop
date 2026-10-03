import { z } from 'zod';
import type { WorkspaceLearningSettings, WorkspaceSettings } from '@prokopai/sdk';

export { defaultLearningCadence } from '@prokopai/sdk';

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
      providerId: z.string().trim().max(200),
      modelId: identifier,
      variant: identifier.nullable().optional(),
      harness: z.enum(['codex-cli', 'claude-cli']).optional(),
    }).strict().superRefine((value, context) => {
      // Harness overrides have no provider; Prokop overrides need one.
      if (!value.harness && !value.providerId) {
        context.addIssue({ code: 'custom', path: ['providerId'], message: 'Prokop model overrides need a provider' });
      }
    }).nullable().default(null),
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

/** Agent learning config stored in the agent preconfig's `settings.learning`.
 * Absent or null means enabled with defaults: agents learn out of the box. */
export const agentLearningConfigSchema = z.object({
  enabled: z.boolean().default(true),
  cadence: learningCadenceSchema.nullable().default(null),
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
}).strict();

export type AgentLearningConfig = z.infer<typeof agentLearningConfigSchema>;

/** Parse the agent config from a preconfig `settings` bag; malformed input
 * falls back to disabled, never to enabled (fail closed like the workspace
 * parser). Absent or null config means enabled defaults. */
export function parseAgentLearningConfig(settings: Record<string, unknown> | null | undefined): AgentLearningConfig | null {
  const raw = settings?.learning;
  if (raw === undefined || raw === null) {
    return agentLearningConfigSchema.parse({});
  }
  const result = agentLearningConfigSchema.safeParse(raw);
  return result.success ? result.data : null;
}

/** The effective learning settings for an agent home: the owning agent is
 * the single reviewer; cadence, instructions, and sources come from the
 * agent config. improveSkills follows the agent skills capability (default
 * on). */
export function agentHomeLearningSettings(config: AgentLearningConfig, agentId: string): WorkspaceLearningSettings {
  return {
    enabled: config.enabled,
    reviewers: [{
      id: agentId,
      preconfigId: agentId,
      instructions: config.instructions,
      modelOverride: null,
      cadence: config.cadence,
    }],
    improveSkills: true,
    instructions: '',
    sources: config.sources,
  };
}

/** Read persisted or external settings without treating malformed input as enabled. */
export function parseLearningSettings(value: unknown): WorkspaceLearningSettings | null {
  const result = learningSettingsSchema.safeParse(value);
  return result.success ? result.data : null;
}

/** Explicit enable action only. Capability dependencies are force-enabled
 * and stay always-allowed (risk 'none'); includeToolResults is preserved. */
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
    memory: { ...settings.memory, enabled: true, permissionRisk: 'none' },
    sessionSearch: { includeToolResults: false, ...settings.sessionSearch, enabled: true, permissionRisk: 'none' },
    learning,
  };
}

/** Do not silently restore dependencies the user explicitly disabled.
 * Agent homes are exempt: their workspace memory surface is force-off by
 * the read policy and learning reads its config from the owning agent. */
export function enforceLearningDependencies(settings: WorkspaceSettings): WorkspaceSettings {
  if (settings.isAgentHome) return settings;
  if (!settings.learning?.enabled || (settings.memory?.enabled && settings.sessionSearch?.enabled)) {
    return settings;
  }
  return { ...settings, learning: { ...settings.learning, enabled: false } };
}
