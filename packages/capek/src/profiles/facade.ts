import type { CapekPlugin } from '../kernel/types';
import { codingAgentBundle } from '../bundles/coding-agent';
import { minimalAgentBundle } from '../bundles/minimal-agent';

export type FacadeProfileId = 'minimal' | 'coding';

export interface FacadeProfile {
  readonly id: FacadeProfileId;
  plugins(): readonly CapekPlugin<unknown>[];
}

export const minimalFacadeProfile: FacadeProfile = {
  id: 'minimal',
  plugins: minimalAgentBundle,
};

export const codingFacadeProfile: FacadeProfile = {
  id: 'coding',
  plugins: codingAgentBundle,
};

export function resolveFacadeProfile(profile: FacadeProfileId = 'coding'): FacadeProfile {
  return profile === 'minimal' ? minimalFacadeProfile : codingFacadeProfile;
}
