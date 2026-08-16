import { isSandboxActive } from '@/sandbox';
import type { Jean2CompatibilityBindings } from './types';

export const jean2SandboxBindings: Jean2CompatibilityBindings['sandbox'] = {
  isSandboxActive,
};
