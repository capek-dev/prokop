import type { AskRequestMessage, AskTimedOutMessage, ServerMessage } from '@jean2/sdk';
import { getJean2CompatibilityBindings } from './bindings';
import type {
  AskBroadcastFn,
  BroadcastFn,
  SubagentInput,
  SubagentOutput,
} from './bindings';

export const createMessage = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['store']['createMessage']>) =>
  getJean2CompatibilityBindings().store.createMessage(...args);
export const updateMessage = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['store']['updateMessage']>) =>
  getJean2CompatibilityBindings().store.updateMessage(...args);
export const getSession = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['store']['getSession']>) =>
  getJean2CompatibilityBindings().store.getSession(...args);
export const updateSession = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['store']['updateSession']>) =>
  getJean2CompatibilityBindings().store.updateSession(...args);
export const transitionToolToInterrupted = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['store']['transitionToolToInterrupted']>) =>
  getJean2CompatibilityBindings().store.transitionToolToInterrupted(...args);
export const syncMessageFts = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['store']['syncMessageFts']>) =>
  getJean2CompatibilityBindings().store.syncMessageFts(...args);
export const getPartsByMessage = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['store']['getPartsByMessage']>) =>
  getJean2CompatibilityBindings().store.getPartsByMessage(...args);
export const createPart = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['store']['createPart']>) =>
  getJean2CompatibilityBindings().store.createPart(...args);
export const updatePart = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['store']['updatePart']>) =>
  getJean2CompatibilityBindings().store.updatePart(...args);
export const getPart = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['store']['getPart']>) =>
  getJean2CompatibilityBindings().store.getPart(...args);
export const persistStreamingPartSnapshots = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['store']['persistStreamingPartSnapshots']>) =>
  getJean2CompatibilityBindings().store.persistStreamingPartSnapshots(...args);
export const getAttachment = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['store']['getAttachment']>) =>
  getJean2CompatibilityBindings().store.getAttachment(...args);
export const getWorkspace = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['store']['getWorkspace']>) =>
  getJean2CompatibilityBindings().store.getWorkspace(...args);
export const updateWorkspace = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['store']['updateWorkspace']>) =>
  getJean2CompatibilityBindings().store.updateWorkspace(...args);
export const transitionToolToRunningByCallId = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['store']['transitionToolToRunningByCallId']>) =>
  getJean2CompatibilityBindings().store.transitionToolToRunningByCallId(...args);
export const getChildSessions = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['store']['getChildSessions']>) =>
  getJean2CompatibilityBindings().store.getChildSessions(...args);
export const listMessagesWithParts = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['store']['listMessagesWithParts']>) =>
  getJean2CompatibilityBindings().store.listMessagesWithParts(...args);
export const getPartsBySession = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['store']['getPartsBySession']>) =>
  getJean2CompatibilityBindings().store.getPartsBySession(...args);
export const buildEffectiveContextHistory = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['store']['buildEffectiveContextHistory']>) =>
  getJean2CompatibilityBindings().store.buildEffectiveContextHistory(...args);

export const findModel = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['config']['findModel']>) =>
  getJean2CompatibilityBindings().config.findModel(...args);
export const getMaxOutputTokens = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['config']['getMaxOutputTokens']>) =>
  getJean2CompatibilityBindings().config.getMaxOutputTokens(...args);
export const findModelVariant = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['config']['findModelVariant']>) =>
  getJean2CompatibilityBindings().config.findModelVariant(...args);
export const getModelsConfig = () => getJean2CompatibilityBindings().config.getModelsConfig();
export const resolveToolsPath = () => getJean2CompatibilityBindings().config.resolveToolsPath();

export const getCompactionAutoThresholdRatio = () => getJean2CompatibilityBindings().env.getCompactionAutoThresholdRatio();
export const getCompactionAutoReserveCapTokens = () => getJean2CompatibilityBindings().env.getCompactionAutoReserveCapTokens();
export const getCompactionAutoSafetyMarginTokens = () => getJean2CompatibilityBindings().env.getCompactionAutoSafetyMarginTokens();
export const getLLMTemperature = () => getJean2CompatibilityBindings().env.getLLMTemperature();
export const getLLMMaxSteps = () => getJean2CompatibilityBindings().env.getLLMMaxSteps();
export const getLLMBaseUrl = () => getJean2CompatibilityBindings().env.getLLMBaseUrl();
export const getLLMOpenAIApiKey = () => getJean2CompatibilityBindings().env.getLLMOpenAIApiKey();
export const getLLMOpenRouterApiKey = () => getJean2CompatibilityBindings().env.getLLMOpenRouterApiKey();
export const getLLMMinimaxApiKey = () => getJean2CompatibilityBindings().env.getLLMMinimaxApiKey();
export const getLLMZhipuApiKey = () => getJean2CompatibilityBindings().env.getLLMZhipuApiKey();
export const getLLMZhipuCodingApiKey = () => getJean2CompatibilityBindings().env.getLLMZhipuCodingApiKey();
export const getLLMDeepseekApiKey = () => getJean2CompatibilityBindings().env.getLLMDeepseekApiKey();
export const getJean2EnvValue = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['env']['getJean2EnvValue']>) =>
  getJean2CompatibilityBindings().env.getJean2EnvValue(...args);
export const getCompactionModel = () => getJean2CompatibilityBindings().env.getCompactionModel();
export const getCompactionProvider = () => getJean2CompatibilityBindings().env.getCompactionProvider();
export const getCompactionMaxTokens = () => getJean2CompatibilityBindings().env.getCompactionMaxTokens();
export const getCompactionPreserveRecentToolCount = () => getJean2CompatibilityBindings().env.getCompactionPreserveRecentToolCount();
export const getCompactionPreserveSmallToolChars = () => getJean2CompatibilityBindings().env.getCompactionPreserveSmallToolChars();
export const getCompactionToolClearCharsThreshold = () => getJean2CompatibilityBindings().env.getCompactionToolClearCharsThreshold();
export const getCompactionMaxPrunedToolCount = () => getJean2CompatibilityBindings().env.getCompactionMaxPrunedToolCount();

export const getProvider = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['providers']['getProvider']>) =>
  getJean2CompatibilityBindings().providers.getProvider(...args);
export const createModelForProvider = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['providers']['createModelForProvider']>) =>
  getJean2CompatibilityBindings().providers.createModelForProvider(...args);
export const createAskApi = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['asks']['createAskApi']>) =>
  getJean2CompatibilityBindings().asks.createAskApi(...args);
export const rejectPendingAsksBySession = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['asks']['rejectPendingAsksBySession']>) =>
  getJean2CompatibilityBindings().asks.rejectPendingAsksBySession(...args);
export const rejectPendingAsksByToolCallId = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['asks']['rejectPendingAsksByToolCallId']>) =>
  getJean2CompatibilityBindings().asks.rejectPendingAsksByToolCallId(...args);
export const broadcastEvent = (message: ServerMessage): void => getJean2CompatibilityBindings().delivery.broadcastEvent(message);
export const broadcastSessionUpdated = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['delivery']['broadcastSessionUpdated']>) =>
  getJean2CompatibilityBindings().delivery.broadcastSessionUpdated(...args);
export const getAgentDirectory = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['agents']['getAgentDirectory']>) =>
  getJean2CompatibilityBindings().agents.getAgentDirectory(...args);
export const readAgentMemoryFile = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['agents']['readAgentMemoryFile']>) =>
  getJean2CompatibilityBindings().agents.readAgentMemoryFile(...args);
export const initializeWorkspace = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['mcp']['initializeWorkspace']>) =>
  getJean2CompatibilityBindings().mcp.initializeWorkspace(...args);
export const getMcpTools = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['mcp']['getTools']>) =>
  getJean2CompatibilityBindings().mcp.getTools(...args);
export const getUploadDir = () => getJean2CompatibilityBindings().paths.getUploadDir();
export const isPathWithinWorkspace = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['paths']['isPathWithinWorkspace']>) =>
  getJean2CompatibilityBindings().paths.isPathWithinWorkspace(...args);
export const resolvePath = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['paths']['resolvePath']>) =>
  getJean2CompatibilityBindings().paths.resolvePath(...args);
export const readInstallManifest = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['tools']['readInstallManifest']>) =>
  getJean2CompatibilityBindings().tools.readInstallManifest(...args);
export const executeSubagent = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['subagents']['executeSubagent']>) =>
  getJean2CompatibilityBindings().subagents.executeSubagent(...args);
export const getSubagentToolDefinition = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['subagents']['getSubagentToolDefinition']>) =>
  getJean2CompatibilityBindings().subagents.getSubagentToolDefinition(...args);
export const canSpawnSubagent = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['subagents']['canSpawnSubagent']>) =>
  getJean2CompatibilityBindings().subagents.canSpawnSubagent(...args);
export const resolveEffectiveSubagentTargets = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['subagents']['resolveEffectiveSubagentTargets']>) =>
  getJean2CompatibilityBindings().subagents.resolveEffectiveSubagentTargets(...args);
export const executeWorkflow = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['workflows']['executeWorkflow']>) =>
  getJean2CompatibilityBindings().workflows.executeWorkflow(...args);
export const getWorkflowToolDefinition = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['workflows']['getWorkflowToolDefinition']>) =>
  getJean2CompatibilityBindings().workflows.getWorkflowToolDefinition(...args);

export const memoryToolDefinition = () => getJean2CompatibilityBindings().memory.memoryToolDefinition;
export const executeMemoryTool = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['memory']['executeMemoryTool']>) =>
  getJean2CompatibilityBindings().memory.executeMemoryTool(...args);
export const loadMemoryInstructions = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['memory']['loadMemoryInstructions']>) =>
  getJean2CompatibilityBindings().memory.loadMemoryInstructions(...args);
export const getMemoryGuidance = (): string => getJean2CompatibilityBindings().memory.MEMORY_GUIDANCE;
export const getSkillManageToolDefinition = () => getJean2CompatibilityBindings().skills.skillManageToolDefinition;
export const executeSkillManageTool = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['skills']['executeSkillManageTool']>) =>
  getJean2CompatibilityBindings().skills.executeSkillManageTool(...args);
export const buildSkillManageToolDescription = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['skills']['buildSkillManageToolDescription']>) =>
  getJean2CompatibilityBindings().skills.buildSkillManageToolDescription(...args);
export const createSkillTool = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['skills']['createSkillTool']>) =>
  getJean2CompatibilityBindings().skills.createSkillTool(...args);
export const getSkillManageGuidance = (): string => getJean2CompatibilityBindings().skills.SKILL_MANAGE_GUIDANCE;
export const getSessionSearchToolDefinition = () => getJean2CompatibilityBindings().sessionSearch.sessionSearchToolDefinition;
export const executeSessionSearchTool = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['sessionSearch']['executeSessionSearchTool']>) =>
  getJean2CompatibilityBindings().sessionSearch.executeSessionSearchTool(...args);
export const getSessionSearchGuidance = (): string => getJean2CompatibilityBindings().sessionSearch.SESSION_SEARCH_GUIDANCE;
export const getSchedulerToolDefinition = () => getJean2CompatibilityBindings().scheduler.schedulerToolDefinition;
export const executeSchedulerTool = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['scheduler']['executeSchedulerTool']>) =>
  getJean2CompatibilityBindings().scheduler.executeSchedulerTool(...args);
export const buildWorkspaceSystemPrompt = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['context']['buildWorkspaceSystemPrompt']>) =>
  getJean2CompatibilityBindings().context.buildWorkspaceSystemPrompt(...args);
export const loadInstructions = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['context']['loadInstructions']>) =>
  getJean2CompatibilityBindings().context.loadInstructions(...args);
export const formatInstructions = (...args: Parameters<ReturnType<typeof getJean2CompatibilityBindings>['context']['formatInstructions']>) =>
  getJean2CompatibilityBindings().context.formatInstructions(...args);
export const isSandboxActive = (): boolean => getJean2CompatibilityBindings().sandbox.isSandboxActive();
export const getSandboxController = () => getJean2CompatibilityBindings().sandbox.sandboxController;

export type { AskBroadcastFn, BroadcastFn, SubagentInput, SubagentOutput };
export type AskDeliveryMessage = AskRequestMessage | AskTimedOutMessage;
