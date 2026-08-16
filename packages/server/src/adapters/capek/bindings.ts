import {
  setJean2CompatibilityBindings,
  type Jean2CompatibilityBindings,
} from '@capekai/core/compat/jean2';
import { jean2DeliveryBindings } from './delivery';
import { jean2InteractionBindings } from './interaction';
import { jean2SandboxBindings } from './sandbox';
import { jean2TitleBindings } from './titles';
import { jean2WorkspaceBindings } from './workspace';

export const jean2CompatibilityBindings = {
  interaction: jean2InteractionBindings,
  delivery: jean2DeliveryBindings,
  titles: jean2TitleBindings,
  workspace: jean2WorkspaceBindings,
  sandbox: jean2SandboxBindings,
} satisfies Jean2CompatibilityBindings;

export function configureJean2Bindings(): void {
  setJean2CompatibilityBindings(jean2CompatibilityBindings);
}
