import { enterAgentScope } from '@capekai/core/internal/composition';
import {
  createJean2RuntimeComposition,
  type Jean2RuntimeComposition,
} from './composition';

type Jean2RuntimeCompositionFactory = () => Promise<Jean2RuntimeComposition>;
type ExecutionLifecycle = 'open' | 'closing' | 'closed';

const CLOSED_ERROR = 'Jean2 execution scope is shutting down';

let executionCompositionPromise: Promise<Jean2RuntimeComposition> | null = null;
let compositionFactory: Jean2RuntimeCompositionFactory = createJean2RuntimeComposition;
let lifecycle: ExecutionLifecycle = 'open';
let disposalPromise: Promise<void> | null = null;
const activeExecutions = new Set<Promise<unknown>>();

function requireOpenLifecycle(): void {
  if (lifecycle !== 'open') {
    throw new Error(CLOSED_ERROR);
  }
}

export function getJean2ExecutionComposition(): Promise<Jean2RuntimeComposition> {
  requireOpenLifecycle();
  if (executionCompositionPromise === null) {
    const promise = Promise.resolve().then(compositionFactory);
    executionCompositionPromise = promise;
    void promise.catch(() => {
      if (executionCompositionPromise === promise) {
        executionCompositionPromise = null;
      }
    });
  }
  return executionCompositionPromise;
}

export function initializeJean2ExecutionScope(): Promise<Jean2RuntimeComposition> {
  if (lifecycle === 'closing') {
    throw new Error(CLOSED_ERROR);
  }
  if (lifecycle === 'closed') {
    lifecycle = 'open';
    disposalPromise = null;
  }
  return getJean2ExecutionComposition();
}

export function withJean2ExecutionScope<T>(callback: () => Promise<T>): Promise<T> {
  requireOpenLifecycle();
  const composition = getJean2ExecutionComposition();
  const execution = composition.then((resolved) =>
    enterAgentScope(resolved.agentScope, callback),
  );
  activeExecutions.add(execution);
  void execution.then(
    () => activeExecutions.delete(execution),
    () => activeExecutions.delete(execution),
  );
  return execution;
}

export function disposeJean2ExecutionScope(): Promise<void> {
  if (disposalPromise !== null) return disposalPromise;

  lifecycle = 'closing';
  const pendingComposition = executionCompositionPromise;
  const pendingExecutions = [...activeExecutions];

  const disposal = (async (): Promise<void> => {
    await Promise.allSettled(pendingExecutions);

    let composition: Jean2RuntimeComposition | null = null;
    if (pendingComposition !== null) {
      try {
        composition = await pendingComposition;
      } catch {
        composition = null;
      }
    }

    if (composition !== null) {
      try {
        await composition.agentScope.dispose();
      } finally {
        await composition.processScope.dispose();
      }
    }
  })();

  disposalPromise = disposal.finally(() => {
    executionCompositionPromise = null;
    lifecycle = 'closed';
  });
  return disposalPromise;
}

export function setJean2ExecutionCompositionFactoryForTests(
  factory: Jean2RuntimeCompositionFactory,
): void {
  compositionFactory = factory;
}

export function resetJean2ExecutionCompositionFactoryForTests(): void {
  compositionFactory = createJean2RuntimeComposition;
  lifecycle = 'open';
  disposalPromise = null;
}
