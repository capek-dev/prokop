import { useSyncExternalStore, type ReactNode } from 'react';
import { WorkerPoolContext } from '@pierre/diffs/react';
import { getPierreWorkerPool, subscribePierreWorkerPool } from '@/lib/pierreWorkerPool';

const getServerSnapshot = () => undefined;

/**
 * Hands the shared Pierre worker pool to every code/diff surface below it.
 * Undefined until the pool is ready; surfaces then highlight on the main
 * thread exactly as before (see `lib/pierreWorkerPool.ts`).
 */
export function PierreWorkerPoolProvider({ children }: { children?: ReactNode }) {
  const pool = useSyncExternalStore(subscribePierreWorkerPool, getPierreWorkerPool, getServerSnapshot);
  return <WorkerPoolContext.Provider value={pool}>{children}</WorkerPoolContext.Provider>;
}
