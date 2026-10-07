import { deliverCapekEvent } from '@/harnesses/prokop/host/events';
import type { RuntimeHost as ProkopCompatibilityBindings } from '@/infrastructure/runtime/host';

export const prokopDeliveryBindings: ProkopCompatibilityBindings['delivery'] = {
  emit: deliverCapekEvent,
};
