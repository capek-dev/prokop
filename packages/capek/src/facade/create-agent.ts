import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stdin, stdout } from 'node:process';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline/promises';
import type {
  AskRequestMessage,
  AssistantMessage,
  Part,
  Preconfig,
  ServerMessage,
} from '@jean2/sdk';
import { executeCompaction } from '../compaction/executor';
import { interruptManager } from '../core/interrupt';
import { streamChatWithRetry, type StreamChatEvent } from '../retry/stream-chat';
import { SandboxController } from '../sandbox/controller';
import { SandboxProvider } from '../sandbox/provider';
import type { AutoResponderRule, SandboxControlEvent } from '../sandbox/types';
import {
  createFacadeAgentComposition,
  enterAgentScope,
  type AgentScopeHandle,
  type FacadeComposition,
} from '../plugins/compose';
import { capekAgentDriverKey, capekToolResolverKey } from '../plugins/service-keys';
import { createAgentRuntime } from '../runtime/agent-runtime';
import type { AgentDriver } from '../runtime/agent-runtime';
import type { DefaultDriverInput } from '../runtime/default-agent-driver';
import { createAgentStorage } from '../storage/options';
import { resolveFacadeProfile } from '../profiles/facade';
import {
  buildEffectiveContextHistory,
  createMessage,
  createPart,
  getMessageWithParts,
  getSession,
  getToolOutputArtifactPage,
  updateSession,
} from '../storage/runtime';
import { rejectAsk, resolveAsk } from '../permission/ask-user-api';
import { createFacadeConfiguration, resolveFacadeModel } from './configuration';
import { createStandaloneBindings } from './standalone-bindings';
import type {
  Agent,
  AgentError,
  AgentEvent,
  AgentInput,
  AgentResult,
  AgentStorageOption,
  RunOptions,
  UsageSummary,
  AgentDiagnostics,
} from './types';
import type { FacadeProfileId } from '../profiles/facade';

const DEFAULT_PROMPT = `You are a practical coding and research agent. Inspect the workspace before making claims. Use the bundled read and search tools to gather evidence, then answer with concrete findings. Use edit, write, patch, or shell tools only when the user asks for changes. Ask a focused question when required information is missing.`;

export interface TerminalInteraction {
  request(message: AskRequestMessage, signal: AbortSignal): Promise<unknown>;
  close(): void;
}

export interface CreateAgentOptions {
  model: string;
  workspace: string;
  profile?: FacadeProfileId;
  storage?: AgentStorageOption;
  prompt?: string;
  interaction?: false | 'terminal' | ((request: AskRequestMessage) => unknown | Promise<unknown>);
  terminal?: TerminalInteraction;
  sandbox?: boolean | {
    rules?: AutoResponderRule[];
    onEvent?: (event: SandboxControlEvent) => void;
  };
}

class EventChannel implements AsyncIterable<AgentEvent> {
  #events: AgentEvent[] = [];
  #waiters: Array<(value: IteratorResult<AgentEvent>) => void> = [];
  #closed = false;
  #cancelled = false;

  constructor(private readonly onReturn: () => void) {}

  push(event: AgentEvent): void {
    if (this.#closed) return;
    const waiter = this.#waiters.shift();
    if (waiter) waiter({ value: event, done: false });
    else this.#events.push(event);
  }

  close(): void {
    this.#closed = true;
    for (const waiter of this.#waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
    return {
      next: async () => {
        const event = this.#events.shift();
        if (event) return { value: event, done: false };
        if (this.#closed) return { value: undefined, done: true };
        return new Promise<IteratorResult<AgentEvent>>((resolve) => this.#waiters.push(resolve));
      },
      return: async () => {
        if (!this.#cancelled) {
          this.#cancelled = true;
          this.onReturn();
        }
        this.#events = [];
        this.close();
        return { value: undefined, done: true };
      },
    };
  }
}

function inputText(input: AgentInput): string {
  return typeof input === 'string' ? input : input.text;
}

function eventError(event: StreamChatEvent): AgentError | null {
  if (!event.type.startsWith('error')) return null;
  const value = event as { code?: string; message?: string; retryAfterMs?: number };
  return {
    code: value.code ?? event.type,
    message: value.message ?? 'Agent run failed',
    retryable: value.retryAfterMs !== undefined,
  };
}

function messageStatus(message: AssistantMessage): 'streaming' | 'completed' | 'failed' | 'interrupted' {
  return message.status === 'error' ? 'failed' : message.status;
}

function defaultSandboxRules(): AutoResponderRule[] {
  return [{
    label: 'Default deterministic response',
    match: {},
    response: { type: 'text', content: 'Sandbox response.' },
  }];
}

class ReadlineTerminalInteraction implements TerminalInteraction {
  #interface: ReadlineInterface | null = null;

  async request(message: AskRequestMessage, signal: AbortSignal): Promise<unknown> {
    this.close();
    const terminal = createInterface({ input: stdin, output: stdout });
    this.#interface = terminal;
    try {
      if (message.ask.type === 'permission') {
        const answer = await terminal.question(`${message.ask.question} [y/N] `, { signal });
        return answer.trim().toLowerCase() === 'y';
      }
      const prompt = 'question' in message.ask ? message.ask.question : 'Provide the requested client capability response.';
      const answer = await terminal.question(`${prompt}\nEnter JSON or text: `, { signal });
      try {
        return JSON.parse(answer);
      } catch {
        return answer;
      }
    } finally {
      if (this.#interface === terminal) this.#interface = null;
      terminal.close();
    }
  }

  close(): void {
    this.#interface?.close();
    this.#interface = null;
  }
}

export function createAgent(options: CreateAgentOptions): Agent {
  return new StandaloneAgent(options);
}

/** Internal symbol accessor attached to facade agents so focused tests can
 * inspect the composed scopes. It is intentionally not part of the public
 * `Agent` interface and never appears in enumerations. */
const FACADE_COMPOSITION_ACCESSOR = Symbol.for('capek.facade.composition-accessor');

export function getFacadeComposition(agent: Agent): Promise<FacadeComposition> {
  const accessor = (agent as unknown as Record<PropertyKey, unknown>)[FACADE_COMPOSITION_ACCESSOR];
  if (typeof accessor !== 'function') {
    throw new Error('getFacadeComposition requires an agent created by createAgent');
  }
  return accessor() as Promise<FacadeComposition>;
}

class StandaloneAgent implements Agent {
  #workspace: string;
  #prompt: string;
  #interaction: CreateAgentOptions['interaction'];
  #sandboxActive: boolean;
  #sandboxController: SandboxController;
  #storage: ReturnType<typeof createAgentStorage>;
  #selection: ReturnType<typeof resolveFacadeModel>;
  #configuration: ReturnType<typeof createFacadeConfiguration>;
  #bindings: ReturnType<typeof createStandaloneBindings>;
  #providerOverrides = new Map([['sandbox', new SandboxProvider()]]);
  #terminal: TerminalInteraction;
  #tempRoot: string;
  #composition: Promise<FacadeComposition>;
  #scopeDisposed = false;
  #activeSessionId: string | null = null;
  #activePromise: Promise<AgentResult> | null = null;
  #activeAbort: AbortController | null = null;
  #closePromise: Promise<void> | null = null;
  #closed = false;
  #storageClosed = false;

  constructor(options: CreateAgentOptions) {
    if (!options.model.trim()) throw new Error('model is required');
    if (!options.workspace.trim()) throw new Error('workspace is required');
    this.#workspace = options.workspace;
    this.#prompt = options.prompt?.trim() || DEFAULT_PROMPT;
    this.#interaction = options.interaction ?? false;
    this.#terminal = options.terminal ?? new ReadlineTerminalInteraction();
    this.#tempRoot = join(tmpdir(), 'capek', randomUUID());
    this.#sandboxActive = Boolean(options.sandbox);
    this.#sandboxController = new SandboxController(
      typeof options.sandbox === 'object'
        ? [...(options.sandbox.rules ?? []), ...defaultSandboxRules()]
        : defaultSandboxRules(),
    );
    if (typeof options.sandbox === 'object' && options.sandbox.onEvent) {
      this.#sandboxController.setBroadcast(options.sandbox.onEvent);
    }
    this.#storage = createAgentStorage(options.storage);
    this.#selection = resolveFacadeModel(options.model);
    this.#configuration = createFacadeConfiguration(this.#selection);
    this.#bindings = createStandaloneBindings({
      workspace: this.#workspace,
      sandboxActive: this.#sandboxActive,
      tempRoot: this.#tempRoot,
    });
    this.#composition = createFacadeAgentComposition({
      storage: this.#storage.storage,
      configuration: this.#configuration,
      host: this.#bindings,
      contextSources: {},
      toolSource: {},
      sandboxController: this.#sandboxController,
      providerOverrides: this.#providerOverrides,
    }, resolveFacadeProfile(options.profile));
    // An idle agent must never surface an unhandled rejection when scope
    // composition fails. run/close and the test accessor await this same
    // promise and still observe the original rejection.
    void this.#composition.catch(() => {});
    Object.defineProperty(this, FACADE_COMPOSITION_ACCESSOR, {
      value: (): Promise<FacadeComposition> => this.#composition,
      enumerable: false,
    });
  }

  async diagnostics(): Promise<AgentDiagnostics> {
    const composition = await this.#composition;
    return {
      profileId: composition.profileId,
      process: composition.processScope.snapshot(),
      agent: composition.agentScope.snapshot(),
    };
  }

  async run(input: AgentInput, options?: RunOptions): Promise<AgentResult> {
    const sessionId = randomUUID();
    return this.#start(sessionId, input, options, true);
  }

  stream(input: AgentInput, options?: RunOptions): AsyncIterable<AgentEvent> {
    const sessionId = randomUUID();
    const channel = new EventChannel(() => {
      // Interrupting an already-closed agent is a no-op; the catch keeps an
      // abandoned iterator from surfacing a fire-and-forget rejection when
      // composition failed. Active-run cancellation still aborts through
      // interruptSession before the catch applies.
      void this.#interruptSession(sessionId).catch(() => {});
    });
    void this.#start(sessionId, input, options, true, (event) => channel.push(event))
      .then((result) => channel.push({ type: 'result', result }))
      .catch((error: unknown) => {
        const result: AgentResult = {
          status: 'failed',
          text: '',
          parts: [],
          error: {
            code: 'agent_failed',
            message: error instanceof Error ? error.message : String(error),
          },
          sessionId,
        };
        channel.push({ type: 'error', sessionId, error: result.error! });
        channel.push({ type: 'result', result });
      })
      .finally(() => channel.close());
    return channel;
  }

  async resume(sessionId: string, input?: AgentInput, options?: RunOptions): Promise<AgentResult> {
    return this.#start(sessionId, input, options, false);
  }

  async retrieveToolOutput(
    sessionId: string,
    artifactId: string,
    options: { offset?: number; limit?: number } = {},
  ) {
    if (this.#closed) throw new Error('Agent is closed');
    return this.#scope(() => getToolOutputArtifactPage(
      sessionId,
      artifactId,
      options.offset,
      options.limit,
    ));
  }

  async interrupt(): Promise<void> {
    const sessionId = this.#activeSessionId;
    if (sessionId) await this.#interruptSession(sessionId);
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#closed = true;
    const activePromise = this.#activePromise;
    const sessionId = this.#activeSessionId;
    this.#activeAbort?.abort(new Error('Agent closed'));
    this.#terminal.close();
    this.#closePromise = (async () => {
      let cleanupError: unknown;
      if (sessionId) {
        try {
          await this.#interruptSession(sessionId);
        } catch (error: unknown) {
          cleanupError = error;
        }
      }
      await activePromise?.catch(() => {});
      if (!this.#scopeDisposed) {
        this.#scopeDisposed = true;
        try {
          const { agentScope } = await this.#composition;
          await agentScope.dispose();
        } catch (error: unknown) {
          cleanupError ??= error;
        }
      }
      if (!this.#storageClosed) {
        this.#storageClosed = true;
        try {
          this.#storage.close();
        } catch (error: unknown) {
          cleanupError ??= error;
        }
      }
      try {
        await rm(this.#tempRoot, { recursive: true, force: true });
      } catch (error: unknown) {
        cleanupError ??= error;
      }
      if (cleanupError) throw cleanupError;
    })();
    return this.#closePromise;
  }

  #start(
    sessionId: string,
    input: AgentInput | undefined,
    options: RunOptions | undefined,
    createNewSession: boolean,
    emit: (event: AgentEvent) => void = () => {},
  ): Promise<AgentResult> {
    if (this.#closed) return Promise.reject(new Error('Agent is closed'));
    if (this.#activeSessionId) return Promise.reject(new Error('Agent already has an active run'));
    this.#activeSessionId = sessionId;
    const runAbort = new AbortController();
    this.#activeAbort = runAbort;
    const promise = this.#scope(async (agentScope) => {
      const driver = agentScope.require(capekAgentDriverKey);
      const runtime = createAgentRuntime<DefaultDriverInput<AgentResult>, AgentResult>({
        agentScope,
        driver: driver as AgentDriver<DefaultDriverInput<AgentResult>, AgentResult>,
      });
      try {
        return await runtime.run(sessionId, {
          advance: async (context) => ({
            result: await this.#perform(
              agentScope,
              sessionId,
              input,
              options,
              createNewSession,
              emit,
              context.signal,
            ),
            continuation: 'complete',
          }),
        }, {
          signal: runAbort.signal,
          cancellationReason: 'agent interrupted',
        });
      } catch (error: unknown) {
        if (runAbort.signal.aborted) {
          const interrupted: AgentResult = {
            status: 'interrupted',
            text: '',
            parts: [],
            sessionId,
          };
          return interrupted;
        }
        throw error;
      }
    });
    this.#activePromise = promise;
    const clearActive = (): void => {
      if (!runAbort.signal.aborted) runAbort.abort(new Error('Agent run settled'));
      if (this.#activePromise === promise) this.#activePromise = null;
      if (this.#activeSessionId === sessionId) {
        this.#activeSessionId = null;
        this.#activeAbort = null;
      }
    };
    void promise.then(clearActive, clearActive);
    return promise;
  }

  async #perform(
    agentScope: AgentScopeHandle,
    sessionId: string,
    input: AgentInput | undefined,
    options: RunOptions | undefined,
    createNewSession: boolean,
    emit: (event: AgentEvent) => void,
    lifecycleSignal: AbortSignal,
  ): Promise<AgentResult> {
    if (createNewSession) {
      this.#storage.storage.conversation.createSession({
        id: sessionId,
        workspaceId: this.#workspace,
        preconfigId: 'capek-default',
        title: 'Agent session',
        status: 'active',
        metadata: null,
        parentId: null,
        agentName: null,
        selectedModel: this.#selection.modelId,
        selectedProvider: this.#selection.providerId,
      });
    } else if (!getSession(sessionId)) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    emit({ type: 'session.started', sessionId });
    if (input !== undefined) this.#appendUserMessage(sessionId, inputText(input));
    const history = buildEffectiveContextHistory(sessionId).messages;
    const preconfig: Preconfig = {
      id: 'capek-default',
      name: 'Capek',
      description: 'Standalone Capek agent',
      systemPrompt: this.#prompt,
      tools: this.#effectiveToolNames(agentScope),
      model: this.#selection.modelId,
      provider: this.#selection.providerId,
      settings: null,
      isDefault: true,
      mode: 'primary',
      canSpawnSubagents: false,
    };

    let lastAssistant: AssistantMessage | null = null;
    let usage: UsageSummary | undefined;
    let error: AgentError | undefined;
    let needsCompaction = false;
    let retryCancelled = false;
    const interruptFromSignal = (): void => {
      void this.#interruptSession(sessionId);
    };
    options?.signal?.addEventListener('abort', interruptFromSignal, { once: true });

    try {
      if (options?.signal?.aborted || lifecycleSignal.aborted) {
        return { status: 'interrupted', text: '', parts: [], sessionId };
      }
      for await (const event of streamChatWithRetry({
        sessionId,
        preconfig,
        messages: history,
        modelId: this.#selection.modelId,
        providerId: this.#selection.providerId,
        workspacePath: this.#workspace,
        workspaceId: this.#workspace,
        maxSteps: options?.maxSteps,
        broadcastFn: (message) => this.#handleAsk(message, lifecycleSignal),
      })) {
        if (event.type === 'message.created' || event.type === 'message.updated') {
          if (event.message.role !== 'assistant') continue;
          lastAssistant = event.message as AssistantMessage;
          emit({
            type: 'message',
            sessionId,
            messageId: event.message.id,
            status: messageStatus(event.message as AssistantMessage),
          });
          continue;
        }
        if (event.type === 'part.created' || event.type === 'part.updated') {
          emit({ type: 'part', sessionId, part: event.part });
          continue;
        }
        if (event.type === 'part.append') {
          emit({
            type: 'part.append',
            sessionId,
            partId: event.partId,
            field: event.field,
            delta: event.delta,
          });
          continue;
        }
        if (event.type === 'usage') {
          usage = event.usage;
          updateSession(sessionId, {
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            totalTokens: usage.totalTokens,
            cacheReadTokens: usage.cacheReadTokens,
            cacheWriteTokens: usage.cacheWriteTokens,
            noCacheTokens: usage.noCacheTokens,
          });
          emit({ type: 'usage', sessionId, usage });
          continue;
        }
        if (event.type === 'needs_compaction') {
          needsCompaction = true;
          continue;
        }
        if (event.type === 'chat.retry') {
          if (event.status === 'cancelled') retryCancelled = true;
          emit({
            type: 'retry',
            sessionId,
            status: event.status,
            retryNumber: event.retryNumber,
            maxRetries: event.maxRetries,
            message: event.message,
          });
          continue;
        }
        const mappedError = eventError(event);
        if (mappedError) {
          error = mappedError;
          emit({ type: 'error', sessionId, error: mappedError });
        }
      }
      if (needsCompaction && !lifecycleSignal.aborted) {
        emit({ type: 'compaction', sessionId, status: 'started' });
        const compaction = await executeCompaction(
          sessionId,
          'auto',
          undefined,
          undefined,
          lifecycleSignal,
        );
        if (compaction.ok) {
          emit({ type: 'compaction', sessionId, status: 'completed' });
        } else if (!lifecycleSignal.aborted) {
          const compactionError: AgentError = {
            code: 'compaction_failed',
            message: compaction.error,
          };
          emit({ type: 'compaction', sessionId, status: 'failed', error: compactionError });
        }
      }
    } catch (caught: unknown) {
      if (!lifecycleSignal.aborted && !options?.signal?.aborted) {
        error = {
          code: 'agent_failed',
          message: caught instanceof Error ? caught.message : String(caught),
        };
        emit({ type: 'error', sessionId, error });
      }
    } finally {
      options?.signal?.removeEventListener('abort', interruptFromSignal);
    }

    return this.#result(
      sessionId,
      lastAssistant,
      usage,
      error,
      retryCancelled || lifecycleSignal.aborted || options?.signal?.aborted === true,
    );
  }

  #appendUserMessage(sessionId: string, text: string): void {
    const messageId = randomUUID();
    createMessage({
      id: messageId,
      sessionId,
      role: 'user',
      createdAt: Date.now(),
    });
    createPart({
      id: randomUUID(),
      messageId,
      type: 'text',
      text,
      createdAt: Date.now(),
    }, sessionId, { syncFts: false });
  }

  #result(
    sessionId: string,
    message: AssistantMessage | null,
    usage: UsageSummary | undefined,
    error: AgentError | undefined,
    interruptedByCaller: boolean,
  ): AgentResult {
    const stored = message ? getMessageWithParts(message.id) : null;
    const parts = (stored?.parts ?? []) as Part[];
    const text = parts
      .filter((part): part is Extract<Part, { type: 'text' }> => part.type === 'text')
      .map((part) => part.text)
      .join('');
    const interrupted = interruptedByCaller || message?.status === 'interrupted';
    const failed = !interrupted && (Boolean(error) || !message || message.status === 'error');
    return {
      status: interrupted ? 'interrupted' : failed ? 'failed' : 'completed',
      text,
      parts,
      ...(usage ? { usage } : {}),
      ...(message?.structuredOutput ? { structuredOutput: message.structuredOutput } : {}),
      ...(failed ? { error: error ?? { code: 'agent_failed', message: message?.error ?? 'Agent run failed' } } : {}),
      sessionId,
    };
  }

  #effectiveToolNames(agentScope: AgentScopeHandle): string[] {
    const resolver = agentScope.require(capekToolResolverKey);
    const names = resolver.list().map((entry) => entry.definition.name);
    return this.#interaction === false
      ? names.filter((name) => name !== 'question')
      : names;
  }

  async #interruptSession(sessionId: string): Promise<void> {
    if (this.#activeSessionId === sessionId) {
      this.#activeAbort?.abort(new Error('Agent interrupted'));
      this.#terminal.close();
    } else if (this.#closed) {
      // The run already settled during close; nothing is left to interrupt
      // and the composed scope may already be disposed.
      return;
    }
    await this.#scope(() => interruptManager.interruptSession(sessionId));
  }

  #scope<T>(callback: (agentScope: AgentScopeHandle) => T | Promise<T>): Promise<T> {
    return this.#composition.then(({ agentScope }) =>
      enterAgentScope(agentScope, () => callback(agentScope)));
  }

  #handleAsk(message: ServerMessage, lifecycleSignal: AbortSignal): void {
    if (message.type !== 'ask.request') return;
    queueMicrotask(() => {
      void this.#resolveInteraction(message as AskRequestMessage, lifecycleSignal);
    });
  }

  async #resolveInteraction(message: AskRequestMessage, lifecycleSignal: AbortSignal): Promise<void> {
    let response: unknown;
    let interactionError: unknown;
    try {
      if (this.#interaction === 'terminal') {
        response = await this.#terminal.request(message, lifecycleSignal);
      } else if (typeof this.#interaction === 'function') {
        response = await this.#interaction(message);
      }
    } catch (error: unknown) {
      interactionError = error;
    }

    if (message.ask.type === 'permission') {
      if (response === true) response = { type: 'permission', grant: 'once' };
      if (response === false || response === undefined || interactionError) {
        response = { type: 'permission', grant: 'deny' };
      }
      resolveAsk(message.toolCallId, response, message.requestId);
      return;
    }

    if (response === undefined || interactionError) {
      const messageText = interactionError instanceof Error
        ? interactionError.message
        : 'User interaction did not return a response';
      rejectAsk(message.toolCallId, new Error(messageText));
      return;
    }
    resolveAsk(message.toolCallId, response, message.requestId);
  }
}

export const facadeRuntimeIdentity = streamChatWithRetry;
