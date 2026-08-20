/**
 * Composition-based standalone agent harness: the minimal run loop a
 * composition user writes, kept here so tests exercise the exact public
 * path the study docs teach (no facade, no hidden orchestration).
 */

import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AskRequestMessage, AssistantMessage, Part } from '@capekai/types';
import type { LoadedTool } from '@capekai/tool';
import { createComposition, createProcessScope, enterAgentScope, facadeProcessPlugins, type Composition } from '@capekai/core/composition';
import { createSingleModelConfiguration, resolveModelSpecifier } from '@capekai/core/configuration';
import { createStandaloneHost } from '@capekai/core/hosts';
import { SandboxController, SandboxProvider } from '@capekai/core/sandbox';
import type { AutoResponderRule, SandboxControlEvent } from '@capekai/core/sandbox';
import { createAgentStorage, type AgentStorage, type AgentStorageOption } from '@capekai/core/storage';
import { streamChatWithRetry } from '@capekai/core/execution';
import { rejectAsk, resolveAsk } from '../../src/permission/ask-user-api';
import type { Preconfig } from '@capekai/types';

export const DEFAULT_PROMPT = `You are a practical coding and research agent. Inspect the workspace with the available tools before making claims, then answer with concrete findings. Only make changes when the user asks for them. Ask a focused question when required information is missing.`;

export interface StandaloneAgentOptions {
  model: string;
  workspace: string;
  tools?: LoadedTool[];
  storage?: AgentStorageOption;
  prompt?: string;
  interaction?: false | ((request: AskRequestMessage) => unknown | Promise<unknown>);
  sandbox?: boolean | { rules?: AutoResponderRule[]; onEvent?: (event: SandboxControlEvent) => void };
}

export interface StandaloneRunResult {
  status: 'completed' | 'failed' | 'interrupted';
  text: string;
  parts: Part[];
  sessionId: string;
  error?: { code: string; message: string; retryable?: boolean };
}

function defaultSandboxRules(): AutoResponderRule[] {
  return [{
    label: 'Default deterministic response',
    match: {},
    response: { type: 'text', content: 'Sandbox response.' },
  }];
}

/** The minimal composition run loop: create session, append user input,
 * stream one turn, assemble the result. Written the way the study docs
 * teach it; the tests pin that this public path really runs. */
export class StandaloneAgent {
  readonly #options: StandaloneAgentOptions;
  readonly #composition: Promise<Composition>;
  readonly #storage: Promise<AgentStorage>;
  readonly #selection: ReturnType<typeof resolveModelSpecifier>;
  readonly #sandboxController: SandboxController;
  readonly #tempRoot: string;
  #closed = false;

  constructor(options: StandaloneAgentOptions) {
    this.#options = options;
    this.#tempRoot = join(tmpdir(), 'capek', randomUUID());
    this.#selection = resolveModelSpecifier(options.model);
    this.#sandboxController = new SandboxController(
      typeof options.sandbox === 'object'
        ? [...(options.sandbox.rules ?? []), ...defaultSandboxRules()]
        : defaultSandboxRules(),
    );
    if (typeof options.sandbox === 'object' && options.sandbox.onEvent) {
      this.#sandboxController.setBroadcast(options.sandbox.onEvent);
    }
    this.#storage = createAgentStorage(options.storage);
    const storagePromise = this.#storage;
    const selection = this.#selection;
    const tempRoot = this.#tempRoot;
    const sandboxController = this.#sandboxController;
    this.#composition = (async () => {
      const storage = await storagePromise;
      const processScope = await createProcessScope([...facadeProcessPlugins()]);
      return createComposition(processScope, {
        storage,
        configuration: createSingleModelConfiguration(selection),
        host: createStandaloneHost({
          workspace: options.workspace,
          sandboxActive: Boolean(options.sandbox),
          tempRoot,
        }),
        contextSources: {},
        workspaceToolDiscovery: {},
        sandboxController,
        providerOverrides: new Map([['sandbox', new SandboxProvider()]]),
        loadedTools: options.tools ?? [],
      });
    })();
  }

  get composition(): Promise<Composition> {
    return this.#composition;
  }

  async run(input: string, options?: { maxSteps?: number }): Promise<StandaloneRunResult> {
    if (this.#closed) throw new Error('Agent is closed');
    const sessionId = randomUUID();
    const { agentScope } = await this.#composition;
    const storage = await this.#storage;
    return enterAgentScope(agentScope, async () => {
      await storage.conversation.createSession({
        id: sessionId,
        workspaceId: this.#options.workspace,
        preconfigId: 'capek-default',
        title: 'Agent session',
        status: 'active',
        metadata: null,
        parentId: null,
        agentName: null,
        selectedModel: this.#selection.modelId,
        selectedProvider: this.#selection.providerId,
      });
      const message = await storage.conversation.createMessage({
        id: randomUUID(),
        sessionId,
        role: 'user',
        createdAt: Date.now(),
      });
      await storage.conversation.createPart({
        id: randomUUID(),
        messageId: message.id,
        type: 'text',
        text: input,
        createdAt: Date.now(),
      }, sessionId);
      const history = await storage.conversation.buildEffectiveContextHistory(sessionId);
      const tools = agentScope.listTools().map((tool) => tool.definition.name).filter((name) => name !== 'question' || typeof this.#options.interaction === 'function');
      const preconfig: Preconfig = {
        id: 'capek-default',
        name: 'Capek',
        description: 'Standalone composition agent',
        systemPrompt: this.#options.prompt?.trim() || DEFAULT_PROMPT,
        tools,
        model: this.#selection.modelId,
        provider: this.#selection.providerId,
        settings: null,
        isDefault: true,
        mode: 'primary',
        canSpawnSubagents: false,
      };
      let lastAssistant: AssistantMessage | null = null;
      let error: StandaloneRunResult['error'];
      for await (const event of streamChatWithRetry({
        sessionId,
        preconfig,
        messages: history.messages,
        modelId: this.#selection.modelId,
        providerId: this.#selection.providerId,
        workspacePath: this.#options.workspace,
        workspaceId: this.#options.workspace,
        maxSteps: options?.maxSteps,
        broadcastFn: (message) => { this.#handleAsk(message); },
      })) {
        if (event.type === 'message.created' || event.type === 'message.updated') {
          if (event.message.role === 'assistant') lastAssistant = event.message as AssistantMessage;
        }
        if (event.type.startsWith('error')) {
          const value = event as { code?: string; message?: string };
          error = { code: value.code ?? event.type, message: value.message ?? 'Agent run failed' };
        }
      }
      const stored = lastAssistant ? await storage.conversation.getMessageWithParts(lastAssistant.id) : null;
      const parts = (stored?.parts ?? []) as Part[];
      const text = parts
        .filter((part): part is Extract<Part, { type: 'text' }> => part.type === 'text')
        .map((part) => part.text)
        .join('');
      const interrupted = false;
      return {
        status: interrupted ? 'interrupted' : error || !lastAssistant ? 'failed' : 'completed',
        text,
        parts,
        sessionId,
        ...(error ? { error } : {}),
      };
    });
  }

  async retrieveToolOutput(sessionId: string, artifactId: string): Promise<{ content: string } | null> {
    if (this.#closed) throw new Error('Agent is closed');
    const { agentScope } = await this.#composition;
    const { getToolOutputArtifactPage } = await import('@capekai/core/storage');
    return enterAgentScope(agentScope, () =>
      getToolOutputArtifactPage(sessionId, artifactId));
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    const { agentScope, processScope } = await this.#composition.catch(() => null as unknown as Composition);
    if (agentScope) await agentScope.dispose().catch(() => {});
    if (processScope) await processScope.dispose().catch(() => {});
    const storage = await this.#storage.catch(() => null);
    storage?.close();
  }

  #handleAsk(message: unknown): void {
    const request = message as AskRequestMessage;
    if ((request as { type?: string }).type !== 'ask.request') return;
    const interaction = this.#options.interaction;
    if (typeof interaction !== 'function') {
      // Headless without interaction: permissions deny, generic asks reject,
      // exactly like the former facade's false branch. Deferred one microtask
      // so the async createPendingAsk persistence wins the race.
      queueMicrotask(() => {
        if (request.ask.type === 'permission') {
          void resolveAsk(request.toolCallId, { type: 'permission', grant: 'deny' }, request.requestId);
        } else {
          void rejectAsk(request.toolCallId, new Error('No interaction handler configured'));
        }
      });
      return;
    }
    queueMicrotask(() => {
      void (async () => {
      let response: unknown;
      let failure: unknown;
      try {
        response = await interaction(request);
      } catch (error) {
        failure = error;
      }
      if (request.ask.type === 'permission') {
        if (response === true) response = { type: 'permission', grant: 'once' };
        if (response === false || response === undefined || failure) {
          response = { type: 'permission', grant: 'deny' } as unknown;
        }
      }
      if (response === undefined || (failure && request.ask.type !== 'permission')) {
        void rejectAsk(request.toolCallId, failure instanceof Error ? failure : new Error('interaction failed'));
        return;
      }
      void resolveAsk(request.toolCallId, response, request.requestId);
      })();
    });
  }
}

export type { AutoResponderRule, SandboxControlEvent };
