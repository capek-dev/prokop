import {
  generateSessionTitle,
  hasManualSessionTitle,
  isDefaultSessionTitle,
} from '@/infrastructure/session-title';
import type { RuntimeHost as ProkopCompatibilityBindings } from '@/infrastructure/runtime/host';

export const prokopTitleBindings: ProkopCompatibilityBindings['titles'] = {
  isDefaultSessionTitle,
  hasManualSessionTitle,
  generateSessionTitle,
};
