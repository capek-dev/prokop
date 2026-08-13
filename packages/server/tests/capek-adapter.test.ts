import { describe, expect, test } from 'bun:test';
import {
  getJean2CompatibilityBindings,
  interruptManager as packageInterruptManager,
} from '@capekai/core/compat/jean2';
import {
  configureCapekJean2Compatibility,
  jean2CompatibilityBindings,
} from '@/capek-adapter';
import { interruptManager as serverInterruptManager } from '@/core/interrupt';
import { sandboxController as packageHostController } from '@/sandbox';
import { sandboxController as serverController } from '@/sandbox/controller';
import { getSession } from '@/store';
import { readInstallManifest } from '@/tools/tool-install-manifest';

const expectedGroupOperations: Record<keyof typeof jean2CompatibilityBindings, string[]> = {
  store: [
    'createSession', 'createMessage', 'getMessage', 'getMessageWithParts', 'deleteMessage',
    'updateMessage', 'getSession', 'updateSession', 'transitionToolToInterrupted',
    'syncMessageFts', 'getPartsByMessage', 'createPart', 'updatePart', 'getPart',
    'persistStreamingPartSnapshots', 'getAttachment', 'getWorkspace', 'updateWorkspace',
    'transitionToolToRunningByCallId', 'getChildSessions', 'listMessagesWithParts',
    'listLatestMessagesWithPartsPage', 'getPartsBySession', 'buildEffectiveContextHistory',
    'addMessageToQueue', 'deleteQueuedMessage', 'getNextQueuedMessage',
    'getResponseFormat', 'getWorkspaceAutoApproveSeverity',
  ],
  config: [
    'findModel', 'getMaxOutputTokens', 'findModelVariant', 'getModelsConfig',
    'resolveToolsPath', 'getPreconfig', 'getDefaultPreconfig', 'getPreconfigOrAgent',
    'listPreconfigs', 'listSubagentPreconfigs',
  ],
  env: [
    'getCompactionAutoThresholdRatio', 'getCompactionAutoReserveCapTokens',
    'getCompactionAutoSafetyMarginTokens', 'getLLMTemperature', 'getLLMMaxSteps',
    'getLLMSubagentMaxSteps', 'getLLMBaseUrl', 'getLLMOpenAIApiKey', 'getLLMOpenRouterApiKey',
    'getLLMMinimaxApiKey', 'getLLMZhipuApiKey', 'getLLMZhipuCodingApiKey',
    'getLLMDeepseekApiKey', 'getJean2EnvValue', 'getCompactionModel',
    'getCompactionProvider', 'getCompactionMaxTokens',
    'getCompactionPreserveRecentToolCount', 'getCompactionPreserveSmallToolChars',
    'getCompactionToolClearCharsThreshold', 'getCompactionMaxPrunedToolCount',
  ],
  providers: ['getProvider', 'createModelForProvider'],
  asks: ['createAskApi', 'rejectPendingAsksBySession', 'rejectPendingAsksByToolCallId'],
  delivery: [
    'broadcastEvent', 'broadcastSessionCreated', 'broadcastSessionUpdated',
    'broadcastToSessionEvent', 'sendToControllerEvent', 'sendToAskTargetsEvent',
    'notifyTerminalMessage',
  ],
  titles: ['isDefaultSessionTitle', 'hasManualSessionTitle', 'generateSessionTitle'],
  agents: ['getAgentDirectory', 'readAgentMemoryFile'],
  mcp: ['initializeWorkspace', 'getTools'],
  paths: ['getUploadDir', 'isPathWithinWorkspace', 'resolvePath'],
  tools: ['readInstallManifest'],
  memory: ['memoryToolDefinition', 'executeMemoryTool', 'loadMemoryInstructions', 'MEMORY_GUIDANCE'],
  skills: [
    'skillManageToolDefinition', 'executeSkillManageTool',
    'buildSkillManageToolDescription', 'createSkillTool', 'SKILL_MANAGE_GUIDANCE',
  ],
  sessionSearch: ['sessionSearchToolDefinition', 'executeSessionSearchTool', 'SESSION_SEARCH_GUIDANCE'],
  scheduler: ['schedulerToolDefinition', 'executeSchedulerTool'],
  context: ['buildWorkspaceSystemPrompt', 'loadInstructions', 'formatInstructions'],
  sandbox: ['isSandboxActive', 'sandboxController'],
};

describe('Čapek Jean2 adapter', () => {
  test('supplies every exact binding operation with no shadowed extras', () => {
    for (const [group, expected] of Object.entries(expectedGroupOperations)) {
      expect(Object.keys(jean2CompatibilityBindings[group as keyof typeof jean2CompatibilityBindings]).sort())
        .toEqual([...expected].sort());
    }
  });

  test('configures the exact adapter value and preserves host function identity', () => {
    configureCapekJean2Compatibility();
    const configured = getJean2CompatibilityBindings();

    expect(configured).toBe(jean2CompatibilityBindings);
    expect(configured.store.getSession).toBe(getSession);
    expect(configured.tools.readInstallManifest).toBe(readInstallManifest);
  });

  test('preserves interrupt and sandbox controller singleton identity', () => {
    configureCapekJean2Compatibility();
    const configured = getJean2CompatibilityBindings();

    expect(serverInterruptManager).toBe(packageInterruptManager);
    expect(packageHostController).toBe(serverController);
    expect(configured.sandbox.sandboxController).toBe(serverController);
  });
});
