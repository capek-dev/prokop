/**
 * S4 compatibility re-export: the schedule computation and display policy
 * moved to the scheduling domain (`@/domains/scheduling/schedule`). The
 * pre-S4 import path keeps working until consumers migrate.
 */
export { computeNextRun, scheduleDisplay } from '@/domains/scheduling/schedule';
