import { tmpdir } from 'os';
import { join } from 'path';
import {
  configureAgentSource,
  configureInstructionSource,
  configurePreconfigSource,
  configureRuntimeConfiguration,
  configureSchedulerHost,
  configureSessionSearchHost,
  configureToolsPath,
  configureToolSource,
  setJean2CompatibilityBindings,
  type Jean2CompatibilityBindings,
  type RuntimeConfiguration,
  type SchedulerHost,
  type SessionSearchHost,
} from '@capekai/core/compat/jean2';
import {
  configureStorage,
  type StorageBundle,
} from '@capekai/core/storage';
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
  getPermissionTimeoutMs,
} from '@/env';
import { getTools, initializeWorkspace } from '@/mcp';
import { getGlobalAgentsPath, getToolsDir, getUploadDir } from '@/paths';
import { notifyPermissionRequired, notifyTerminalMessage } from '@/services/web-push/dispatch';
import { isSandboxActive } from '@/sandbox';
import { runScheduledJob } from '@/scheduler/runner';
import { getMessageContentForFts, searchMessages } from '@/session-search/fts';
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
  getDatabase,
  getSession,
  getSessionsByAgent,
  getWorkspace,
  listSessionsByWorkspace,
  listLatestMessagesWithPartsPage,
  listMessagesWithParts,
  persistStreamingPartSnapshots,
  syncMessageFts,
  transitionToolToInterrupted,
  transitionToolToRunningByCallId,
  updateMessage,
  updatePart,
  updateSession,
} from '@/store';
import {
  addWorkspaceAdditionalPath,
  getWorkspaceAutoApproveSeverity,
  removeWorkspaceAdditionalPath,
} from '@/store/workspaces';
import {
  cancelPendingRequestsBySession,
  createPendingAsk,
  expireOldPermissionRequests,
  expirePermissionRequest,
  getPermissionRequestByRequestId,
  listPendingAsksByRootSession,
  listPendingAsksBySession,
  listPendingRequestsByRootSession,
  removePendingAsk,
  removePendingAsksByToolCallId,
  resolvePermissionRequestByRequestId,
} from '@/store/pending-asks';
import { createGrantFromOptions, matchGrant } from '@/store/permissions';
import {
  createScheduledJob,
  deleteScheduledJob,
  getScheduledJob,
  listScheduledJobs,
  updateScheduledJob,
} from '@/store/scheduled-jobs';

export const jean2StorageBundle: StorageBundle = {
  conversation: {
    createSession,
    createMessage,
    getMessage,
    getMessageWithParts,
    deleteMessage,
    updateMessage: (id, updates) => updateMessage(id, updates, { syncFts: false }),
    getSession,
    updateSession,
    transitionToolToInterrupted,
    getPartsByMessage,
    createPart: (part, sessionId) => createPart(part, sessionId, { syncFts: false }),
    updatePart: (id, updates) => updatePart(id, updates, { syncFts: false }),
    getPart,
    persistStreamingPartSnapshots,
    transitionToolToRunningByCallId,
    getChildSessions,
    listMessagesWithParts,
    listLatestMessagesWithPartsPage,
    getPartsBySession,
    buildEffectiveContextHistory,
  },
  queue: {
    addMessage: addMessageToQueue,
    delete: deleteQueuedMessage,
    peek: getNextQueuedMessage,
  },
  attachments: { get: getAttachment },
  workspaces: {
    get: getWorkspace,
    getAutoApproveSeverity: getWorkspaceAutoApproveSeverity,
  },
  responseFormats: { get: getResponseFormat },
  index: { syncMessage: syncMessageFts },
};

export const jean2RuntimeConfiguration: RuntimeConfiguration = {
  findModel,
  getMaxOutputTokens,
  findModelVariant,
  getModelsConfig,
  getLLMTemperature,
  getLLMMaxSteps,
  getLLMSubagentMaxSteps,
  getLLMBaseUrl,
  getApiKey(providerId) {
    switch (providerId) {
      case 'openai': return getLLMOpenAIApiKey();
      case 'openrouter': return getLLMOpenRouterApiKey();
      case 'minimax': return getLLMMinimaxApiKey();
      case 'zhipu': return getLLMZhipuApiKey();
      case 'zhipu-coding': return getLLMZhipuCodingApiKey();
      case 'deepseek': return getLLMDeepseekApiKey();
      default: return undefined;
    }
  },
  getCompactionModel,
  getCompactionProvider,
  getCompactionMaxTokens,
  getCompactionPreserveRecentToolCount,
  getCompactionPreserveSmallToolChars,
  getCompactionToolClearCharsThreshold,
  getCompactionMaxPrunedToolCount,
  getCompactionAutoThresholdRatio,
  getCompactionAutoReserveCapTokens,
  getCompactionAutoSafetyMarginTokens,
};

export const jean2SessionSearchHost: SessionSearchHost = {
  getWorkspace,
  getSession,
  listWorkspaceSessions: (workspaceId) => listSessionsByWorkspace(workspaceId, { rootOnly: true }),
  listAgentSessions: (agentId, limit) => getSessionsByAgent(agentId, undefined, limit),
  countSessionMessages(sessionId) {
    return (getDatabase().query(
      'SELECT COUNT(*) as cnt FROM messages WHERE session_id = ?',
    ).get(sessionId) as { cnt: number }).cnt;
  },
  searchMessages,
  countMessagesBefore(sessionId, timestamp) {
    return (getDatabase().query(
      'SELECT COUNT(*) as cnt FROM messages WHERE session_id = ? AND created_at < ?',
    ).get(sessionId, timestamp) as { cnt: number }).cnt;
  },
  countMessagesAfter(sessionId, timestamp) {
    return (getDatabase().query(
      'SELECT COUNT(*) as cnt FROM messages WHERE session_id = ? AND created_at > ?',
    ).get(sessionId, timestamp) as { cnt: number }).cnt;
  },
  getLatestMessage(sessionId) {
    const row = getDatabase().query(
      'SELECT id, created_at FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 1',
    ).get(sessionId) as { id: string; created_at: number } | undefined;
    return row ? { id: row.id, timestamp: row.created_at } : null;
  },
  getMessage(messageId, sessionId) {
    const row = getDatabase().query(
      'SELECT id, created_at FROM messages WHERE id = ? AND session_id = ?',
    ).get(messageId, sessionId) as { id: string; created_at: number } | undefined;
    return row ? { id: row.id, timestamp: row.created_at } : null;
  },
  listMessagesBefore(sessionId, timestamp, limit) {
    const rows = getDatabase().query(
      'SELECT id, role, created_at FROM messages WHERE session_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?',
    ).all(sessionId, timestamp, limit) as Array<{ id: string; role: string; created_at: number }>;
    return rows.map((row) => ({ id: row.id, role: row.role, timestamp: row.created_at }));
  },
  listMessagesAfter(sessionId, timestamp, limit) {
    const rows = getDatabase().query(
      'SELECT id, role, created_at FROM messages WHERE session_id = ? AND created_at > ? ORDER BY created_at ASC LIMIT ?',
    ).all(sessionId, timestamp, limit) as Array<{ id: string; role: string; created_at: number }>;
    return rows.map((row) => ({ id: row.id, role: row.role, timestamp: row.created_at }));
  },
  getMessageSummary(messageId) {
    const row = getDatabase().query(
      'SELECT role, created_at FROM messages WHERE id = ?',
    ).get(messageId) as { role: string; created_at: number } | undefined;
    if (!row) return null;
    const { content, toolName } = getMessageContentForFts(messageId);
    return { role: row.role, timestamp: row.created_at, content, toolName };
  },
};

export const jean2SchedulerHost: SchedulerHost = {
  create: createScheduledJob,
  get: getScheduledJob,
  list: listScheduledJobs,
  update: updateScheduledJob,
  delete: deleteScheduledJob,
  trigger(job) {
    runScheduledJob(job).catch((error: unknown) => {
      console.error(`[scheduler-tool] Trigger of '${job.name}' failed:`, error);
    });
  },
};

export const jean2CompatibilityBindings = {
  interaction: {
    createPendingAsk,
    removePendingAsk,
    removePendingAsksByToolCallId,
    getPermissionRequestByRequestId,
    resolvePermissionRequestByRequestId,
    expirePermissionRequest,
    expireOldPermissionRequests,
    cancelPendingRequestsBySession,
    listPendingAsksBySession,
    listPendingAsksByRootSession,
    listPendingRequestsByRootSession,
    matchGrant,
    createGrantFromOptions,
    getSessionAutoApproveSeverity: (sessionId: string) => getSession(sessionId)?.autoApproveSeverity ?? undefined,
    getPermissionTimeoutMs,
    notifyPermissionRequired,
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
  workspace: {
    createToolWorkspaceHost: ({ workspaceId, workspacePath, additionalPaths, sessionId }) => ({
      root: workspacePath,
      additionalRoots: additionalPaths,
      allowedRoots: [getUploadDir()],
      tempDir: join(tmpdir(), 'jean2', sessionId),
      getEnvironmentValue: getJean2EnvValue,
      addAdditionalRoot: workspaceId
        ? (path: string) => addWorkspaceAdditionalPath(workspaceId, path)
        : undefined,
      removeAdditionalRoot: workspaceId
        ? (path: string) => removeWorkspaceAdditionalPath(workspaceId, path)
        : undefined,
    }),
  },
  sandbox: {
    isSandboxActive,
  },
} satisfies Jean2CompatibilityBindings;

export function configureCapekJean2Compatibility(): void {
  configureStorage(jean2StorageBundle);
  configureRuntimeConfiguration(jean2RuntimeConfiguration);
  configurePreconfigSource({
    get: getPreconfig,
    getDefault: getDefaultPreconfig,
    getForAgent: getPreconfigOrAgent,
    list: listPreconfigs,
    listSubagents: listSubagentPreconfigs,
  });
  configureAgentSource({
    getDirectory: getAgentDirectory,
    readMemoryFile: readAgentMemoryFile,
  });
  configureInstructionSource({ getGlobalPath: getGlobalAgentsPath });
  configureSessionSearchHost(jean2SessionSearchHost);
  configureSchedulerHost(jean2SchedulerHost);
  try {
    configureToolsPath(resolveToolsPath());
  } catch {
    configureToolsPath(process.env.JEAN2_TOOLS_PATH || getToolsDir());
  }
  configureToolSource({
    initializeWorkspace,
    discoverTools: getTools,
  });
  setJean2CompatibilityBindings(jean2CompatibilityBindings);
}
