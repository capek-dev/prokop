import type { BroadcastFn, BroadcastSessionFn } from '../runtime/host';
import {
  runOrchestratorSession,
  type OrchestratorSessionOptions,
  type OrchestratorSessionResult,
} from './orchestrator-session';

/** Workflow domain: leaf result synthesis. Moved byte-for-byte from
 * `core/workflow-synthesizer.ts`; the unscoped export keeps the pre-C5
 * module-accessor behavior, and the WithDeps variant runs against the
 * injected orchestrator contract captured by the domain plugin. */

/** Result from a single leaf agent execution. */
export interface LeafResult {
  index: number;
  text: string;
  structuredResult?: Record<string, unknown>;
  error?: string;
}

/** Result from the synthesis phase. */
export interface SynthesisResult {
  text: string;
  structuredResult?: Record<string, unknown>;
}

export interface SynthesizeResultsOptions {
  originalPrompt: string;
  leafResults: LeafResult[];
  outputSchema?: Record<string, unknown>;
  parentSessionId: string;
  abortSignal?: AbortSignal;
  broadcast?: BroadcastFn;
  broadcastSessionCreated?: BroadcastSessionFn;
  broadcastSessionUpdated?: BroadcastSessionFn;
  runOrchestrator?: typeof runOrchestratorSession;
}

export interface SynthesizeResultsDeps {
  orchestrator: { run(options: OrchestratorSessionOptions): Promise<OrchestratorSessionResult> };
}

/** Unscoped synthesis over the module orchestrator implementation. */
export async function synthesizeResults(options: SynthesizeResultsOptions): Promise<SynthesisResult> {
  return synthesizeResultsWithDeps(options, { orchestrator: { run: runOrchestratorSession } });
}

/** Composed synthesis over the injected orchestrator contract. */
export async function synthesizeResultsWithDeps(
  options: SynthesizeResultsOptions,
  deps: SynthesizeResultsDeps,
): Promise<SynthesisResult> {
  console.log('[workflow:synthesize] Starting synthesis', {
    parentSessionId: options.parentSessionId,
    leafResultCount: options.leafResults.length,
    hasOutputSchema: !!options.outputSchema,
  });

  const formattedResults = options.leafResults
    .map((r) => {
      const status = r.error ? '[FAILED]' : '[success]';
      const parts: string[] = [`Sub-agent ${r.index + 1} ${status}:`];
      if (r.error) {
        parts.push(`  Error: ${r.error}`);
      } else {
        parts.push(`  Text: ${r.text || '(no text output)'}`);
        if (r.structuredResult) {
          parts.push(`  Structured: ${JSON.stringify(r.structuredResult)}`);
        }
      }
      return parts.join('\n');
    })
    .join('\n\n');

  let system = [
    'You are a synthesis agent. You have been given the results of several parallel',
    'sub-agents that were each working on part of a larger task.',
    '',
    'Your job:',
    '1. Review all sub-agent results below.',
    '2. Identify overlapping findings, contradictions, and gaps.',
    '3. Produce a single consolidated answer that addresses the original task.',
    '',
    `Original task: ${options.originalPrompt}`,
    '',
    'Sub-agent results:',
    formattedResults,
  ].join('\n');

  let userPrompt = 'Synthesize the sub-agent results into a final answer.';

  // If structured output is requested, inject the schema into the prompt
  // (same approach as agent.ts prompt-based structured output — works universally)
  if (options.outputSchema) {
    const schemaStr = JSON.stringify(options.outputSchema, null, 2);
    system += '\n\n' + [
      'You must respond with ONLY valid JSON that conforms to the following JSON Schema.',
      'Do not include any text before or after the JSON object. Do not wrap it in markdown code fences.',
      '',
      'JSON Schema:',
      schemaStr,
    ].join('\n');
    userPrompt = 'Synthesize the sub-agent results into a final answer. Respond with ONLY valid JSON conforming to the schema.';
  }

  const result = await (options.runOrchestrator ?? deps.orchestrator.run)({
    parentSessionId: options.parentSessionId,
    title: `Synthesize: ${options.originalPrompt.slice(0, 50)}`,
    agentName: 'synthesizer',
    systemPrompt: system,
    userPrompt,
    maxTokens: 8192,
    abortSignal: options.abortSignal,
    broadcast: options.broadcast,
    broadcastSessionCreated: options.broadcastSessionCreated,
    broadcastSessionUpdated: options.broadcastSessionUpdated,
  });

  console.log('[workflow:synthesize] Orchestrator session returned', { textLength: result.text?.length });

  if (options.outputSchema) {
    if (result.json) {
      console.log('[workflow:synthesize] Structured output parsed successfully');
      return { text: result.text, structuredResult: result.json };
    }
    console.warn('[workflow:synthesize] Failed to parse structured output, returning raw text');
  }

  return { text: result.text };
}
