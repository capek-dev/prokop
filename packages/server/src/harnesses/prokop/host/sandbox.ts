import { isSandboxActive } from '@/infrastructure/sandbox';
import type { RuntimeHost as ProkopCompatibilityBindings } from '@/infrastructure/runtime/host';

export const prokopSandboxBindings: ProkopCompatibilityBindings['sandbox'] = {
  isSandboxActive,
};
