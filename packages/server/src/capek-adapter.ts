import { tmpdir } from 'os';
import { join } from 'path';
import {
  setJean2CompatibilityBindings,
  type Jean2CompatibilityBindings,
} from '@capekai/core/compat/jean2';
import { getAgentDirectory, getPreconfigOrAgent } from '@/agents/storage';
import { readAgentMemoryFile } from '@/agents/memory';
import {
  findModel,
  findModelVariant,
  getMaxOutputTokens,
  getModelsConfig,
  resolveToolsPath,
} from '@/config';
import {
  broadcastEvent,
  broadcastSessionCreated,
  broadcastSessionUpdated,
  broadcastToSessionEvent,
  sendToAskTargetsEvent,
  sendToControllerEvent,
} from '@/core/broadcast';
import { getDefaultPreconfig, getPreconfig, listPreconfigs, listSubagentPreconfigs } from '@/core/preconfig';
import { generateSessionTitle, hasManualSessionTitle, isDefaultSessionTitle } from '@/core/session-title';
import { formatInstructions, loadInstructions } from '@/core/instructions';
import { buildWorkspaceSystemPrompt } from '@/core/prompts/workspace-context';
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
  getLLMSubagentMaxSteps,
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
import { notifyTerminalMessage } from '@/services/web-push/dispatch';
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
  addMessageToQueue,
  buildEffectiveContextHistory,
  createMessage,
  createPart,
  createSession,
  deleteMessage,
  deleteQueuedMessage,
  getMessage,
  getMessageWithParts,
  getNextQueuedMessage,
  getAttachment,
  getChildSessions,
  getPart,
  getPartsByMessage,
  getPartsBySession,
  getResponseFormat,
  getSession,
  getWorkspace,
  listLatestMessagesWithPartsPage,
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
import { getWorkspaceAutoApproveSeverity } from '@/store/workspaces';
import {
  createAskApi,
  rejectPendingAsksBySession,
  rejectPendingAsksByToolCallId,
} from '@/tools/ask-user-api';
import { readInstallManifest } from '@/tools/tool-install-manifest';

export const jean2CompatibilityBindings = {
  store: {
    createSession,
    createMessage,
    getMessage,
    getMessageWithParts,
    deleteMessage,
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
    listLatestMessagesWithPartsPage,
    getPartsBySession,
    buildEffectiveContextHistory,
    addMessageToQueue,
    deleteQueuedMessage,
    getNextQueuedMessage,
    getResponseFormat,
    getWorkspaceAutoApproveSeverity,
  },
  config: {
    findModel,
    getMaxOutputTokens,
    findModelVariant,
    getModelsConfig,
    resolveToolsPath,
    getPreconfig,
    getDefaultPreconfig,
    getPreconfigOrAgent,
    listPreconfigs,
    listSubagentPreconfigs,
  },
  env: {
    getCompactionAutoThresholdRatio,
    getCompactionAutoReserveCapTokens,
    getCompactionAutoSafetyMarginTokens,
    getLLMTemperature,
    getLLMMaxSteps,
    getLLMSubagentMaxSteps,
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
    broadcastSessionCreated,
    broadcastSessionUpdated,
    broadcastToSessionEvent,
    sendToControllerEvent,
    sendToAskTargetsEvent,
    notifyTerminalMessage,
  },
  titles: {
    isDefaultSessionTitle,
    hasManualSessionTitle,
    generateSessionTitle,
  },
  agents: {
    getAgentDirectory,
    readAgentMemoryFile,
  },
  mcp: {
    initializeWorkspace,
    getTools,
  },
  workspace: {
    createToolWorkspaceHost: ({ workspaceId, workspacePath, additionalPaths, sessionId }) => ({
      root: workspacePath,
      additionalRoots: additionalPaths,
      allowedRoots: [getUploadDir()],
      tempDir: join(tmpdir(), 'jean2', sessionId),
      getEnvironmentValue: getJean2EnvValue,
      addAdditionalRoot: workspaceId
        ? (path: string) => {
          const workspace = getWorkspace(workspaceId);
          if (!workspace) return false;
          if (workspace.additionalPaths.includes(path)) return true;
          updateWorkspace(workspaceId, {
            additionalPaths: [...workspace.additionalPaths, path],
          });
          return true;
        }
        : undefined,
      removeAdditionalRoot: workspaceId
        ? (path: string) => {
          const workspace = getWorkspace(workspaceId);
          if (!workspace) return false;
          if (!workspace.additionalPaths.includes(path)) return true;
          updateWorkspace(workspaceId, {
            additionalPaths: workspace.additionalPaths.filter((currentPath) => currentPath !== path),
          });
          return true;
        }
        : undefined,
    }),
  },
  tools: {
    readInstallManifest,
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
