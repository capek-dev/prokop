import { isSandboxActive } from '@/infrastructure/sandbox';
import type { Jean2CompatibilityBindings } from './types';

export const jean2SandboxBindings: Jean2CompatibilityBindings['sandbox'] = {
  isSandboxActive,
};
