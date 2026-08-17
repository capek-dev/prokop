import {
  generateSessionTitle,
  hasManualSessionTitle,
  isDefaultSessionTitle,
} from '@/infrastructure/session-title';
import type { Jean2CompatibilityBindings } from './types';

export const jean2TitleBindings: Jean2CompatibilityBindings['titles'] = {
  isDefaultSessionTitle,
  hasManualSessionTitle,
  generateSessionTitle,
};
