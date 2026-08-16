import type { AgentDriver, AgentRunContext } from './agent-runtime';

export interface DriverAdvance<Result> {
  result: Result;
  continuation: 'complete' | 'continue';
}

export interface DefaultDriverInput<Result> {
  advance(context: AgentRunContext): Promise<DriverAdvance<Result>>;
  maxContinuations?: number;
}

export class DefaultAgentDriver implements AgentDriver<DefaultDriverInput<unknown>, unknown> {
  async run(context: AgentRunContext, input: DefaultDriverInput<unknown>): Promise<unknown> {
    const maxContinuations = input.maxContinuations ?? 1_000;
    for (let continuation = 0; continuation <= maxContinuations; continuation += 1) {
      if (context.signal.aborted) throw context.signal.reason;
      const turn = await input.advance(context);
      if (turn.continuation === 'complete') return turn.result;
    }
    throw new Error(`Agent driver exceeded ${maxContinuations} continuations`);
  }
}
