import type { SessionCategory } from '@prokopai/sdk';
import { BadRequestError } from '@/application/http-errors';

export function parseSessionCategory(value: string | undefined): SessionCategory | undefined {
  if (value === undefined || value === 'active' || value === 'archived' || value === 'scheduled') return value;
  throw new BadRequestError('category must be active, archived, or scheduled');
}
