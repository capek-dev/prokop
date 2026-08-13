import {
  setJean2CompatibilityBindings,
  type Jean2CompatibilityBindings,
} from '@capekai/core/compat/jean2';
import { getAgentDirectory } from '@/agents/storage';
import { readAgentMemoryFile } from '@/agents/memory';
import {
  findModel,
  findModelVariant,
  getMaxOutputTokens,
  getModelsConfig,
  resolveToolsPath,
} from '@/config';
import { broadcastEvent, broadcastSessionUpdated } from '@/core/broadcast';
import { formatInstructions, loadInstructions } from '@/core/instructions';
import { buildWorkspaceSystemPrompt } from '@/core/prompts/workspace-context';
import {
  canSpawnSubagent,
  executeSubagent,
  getSubagentToolDefinition,
} from '@/core/subagent';
import { resolveEffectiveSubagentTargets } from '@/core/subagent-policy';
import { executeWorkflow, getWorkflowToolDefinition } from '@/core/workflow';
import {
  getCompactionAutoReserveCapTokens,
  getCompactionAutoSafetyMarginTokens,
  getCompactionAutoThresholdRatio,
  getCompactionMaxPrunedToolCount,
  getCompactionMaxTokens,
  getCompactionModel,
  getCompactionPreserveRecentToolCount,
  getCompactionPreserveSmallToolChars,
  getCompactionProvider,
  getCompactionToolClearCharsThreshold,
  getJean2EnvValue,
  getLLMBaseUrl,
  getLLMDeepseekApiKey,
  getLLMMaxSteps,
  getLLMMinimaxApiKey,
  getLLMOpenAIApiKey,
  getLLMOpenRouterApiKey,
  getLLMTemperature,
  getLLMZhipuApiKey,
  getLLMZhipuCodingApiKey,
} from '@/env';
import { getTools, initializeWorkspace } from '@/mcp';
import {
  MEMORY_GUIDANCE,
  executeMemoryTool,
  loadMemoryInstructions,
  memoryToolDefinition,
} from '@/memory';
import { getUploadDir } from '@/paths';
import { createModelForProvider, getProvider } from '@/providers';
import { isSandboxActive } from '@/sandbox';
import { sandboxController } from '@/sandbox/controller';
import { executeSchedulerTool, schedulerToolDefinition } from '@/scheduler/scheduler-tool';
import {
  SESSION_SEARCH_GUIDANCE,
  executeSessionSearchTool,
  sessionSearchToolDefinition,
} from '@/session-search';
import {
  SKILL_MANAGE_GUIDANCE,
  buildSkillManageToolDescription,
  createSkillTool,
  executeSkillManageTool,
  skillManageToolDefinition,
} from '@/skills';
import {
  buildEffectiveContextHistory,
  createMessage,
  createPart,
  getAttachment,
  getChildSessions,
  getPart,
  getPartsByMessage,
  getPartsBySession,
  getSession,
  getWorkspace,
  listMessagesWithParts,
  persistStreamingPartSnapshots,
  syncMessageFts,
  transitionToolToInterrupted,
  transitionToolToRunningByCallId,
  updateMessage,
  updatePart,
  updateSession,
  updateWorkspace,
} from '@/store';
import {
  createAskApi,
  rejectPendingAsksBySession,
  rejectPendingAsksByToolCallId,
} from '@/tools/ask-user-api';
import { readInstallManifest } from '@/tools/tool-install-manifest';
import { isPathWithinWorkspace, resolvePath } from '@/utils/paths';

export const jean2CompatibilityBindings = {
  store: {
    createMessage,
    updateMessage,
    getSession,
    updateSession,
    transitionToolToInterrupted,
    syncMessageFts,
    getPartsByMessage,
    createPart,
    updatePart,
    getPart,
    persistStreamingPartSnapshots,
    getAttachment,
    getWorkspace,
    updateWorkspace,
    transitionToolToRunningByCallId,
    getChildSessions,
    listMessagesWithParts,
    getPartsBySession,
    buildEffectiveContextHistory,
  },
  config: {
    findModel,
    getMaxOutputTokens,
    findModelVariant,
    getModelsConfig,
    resolveToolsPath,
  },
  env: {
    getCompactionAutoThresholdRatio,
    getCompactionAutoReserveCapTokens,
    getCompactionAutoSafetyMarginTokens,
    getLLMTemperature,
    getLLMMaxSteps,
    getLLMBaseUrl,
    getLLMOpenAIApiKey,
    getLLMOpenRouterApiKey,
    getLLMMinimaxApiKey,
    getLLMZhipuApiKey,
    getLLMZhipuCodingApiKey,
    getLLMDeepseekApiKey,
    getJean2EnvValue,
    getCompactionModel,
    getCompactionProvider,
    getCompactionMaxTokens,
    getCompactionPreserveRecentToolCount,
    getCompactionPreserveSmallToolChars,
    getCompactionToolClearCharsThreshold,
    getCompactionMaxPrunedToolCount,
  },
  providers: {
    getProvider,
    createModelForProvider,
  },
  asks: {
    createAskApi,
    rejectPendingAsksBySession,
    rejectPendingAsksByToolCallId,
  },
  delivery: {
    broadcastEvent,
    broadcastSessionUpdated,
  },
  agents: {
    getAgentDirectory,
    readAgentMemoryFile,
  },
  mcp: {
    initializeWorkspace,
    getTools,
  },
  paths: {
    getUploadDir,
    isPathWithinWorkspace,
    resolvePath,
  },
  tools: {
    readInstallManifest,
  },
  subagents: {
    executeSubagent,
    getSubagentToolDefinition,
    canSpawnSubagent,
    resolveEffectiveSubagentTargets,
  },
  workflows: {
    executeWorkflow,
    getWorkflowToolDefinition,
  },
  memory: {
    memoryToolDefinition,
    executeMemoryTool,
    loadMemoryInstructions,
    MEMORY_GUIDANCE,
  },
  skills: {
    skillManageToolDefinition,
    executeSkillManageTool,
    buildSkillManageToolDescription,
    createSkillTool,
    SKILL_MANAGE_GUIDANCE,
  },
  sessionSearch: {
    sessionSearchToolDefinition,
    executeSessionSearchTool,
    SESSION_SEARCH_GUIDANCE,
  },
  scheduler: {
    schedulerToolDefinition,
    executeSchedulerTool,
  },
  context: {
    buildWorkspaceSystemPrompt,
    loadInstructions,
    formatInstructions,
  },
  sandbox: {
    isSandboxActive,
    sandboxController,
  },
} satisfies Jean2CompatibilityBindings;

export function configureCapekJean2Compatibility(): void {
  setJean2CompatibilityBindings(jean2CompatibilityBindings);
}
