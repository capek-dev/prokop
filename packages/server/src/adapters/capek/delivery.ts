import { deliverCapekEvent } from './events';
import type { Jean2CompatibilityBindings } from './types';

export const jean2DeliveryBindings: Jean2CompatibilityBindings['delivery'] = {
  emit: deliverCapekEvent,
};
