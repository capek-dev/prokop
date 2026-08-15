/**
 * Simple awaited emit. Listeners observe typed runtime events; the kernel
 * dispatches each listener sequentially and awaits it. There is no serial
 * or waterfall interception framework: listeners cannot stop or replace
 * events.
 */

import { EventEmitError, MalformedPluginError, type ListenerFailure } from './errors';
import type {
  EventListenerContribution,
  KernelEvent,
  KernelEventType,
} from './types';

const KNOWN_EVENT_TYPES = new Set<string>(['run:started', 'run:terminal', 'run:disposed']);

export interface ListenerRegistration {
  readonly contribution: EventListenerContribution;
  readonly pluginId: string;
}

export function validateListener(contribution: EventListenerContribution): void {
  if (typeof contribution !== 'object' || contribution === null) {
    throw new MalformedPluginError('listener contribution must be an object');
  }
  if (typeof contribution.id !== 'string' || contribution.id.length === 0) {
    throw new MalformedPluginError('listener contribution id must be a non-empty string');
  }
  if (!Array.isArray(contribution.eventTypes)) {
    throw new MalformedPluginError(
      `listener '${contribution.id}' eventTypes must be an array`,
    );
  }
  if (contribution.eventTypes.length === 0) {
    throw new MalformedPluginError(
      `listener '${contribution.id}' must declare at least one event type`,
    );
  }
  for (const eventType of contribution.eventTypes) {
    if (!KNOWN_EVENT_TYPES.has(eventType)) {
      throw new MalformedPluginError(
        `listener '${contribution.id}' declares unknown event type '${String(eventType)}'`,
      );
    }
  }
  if (typeof contribution.handle !== 'function') {
    throw new MalformedPluginError(
      `listener '${contribution.id}' must provide a handle function`,
    );
  }
}

export interface ListenerScopeView {
  readonly listeners: readonly ListenerRegistration[];
}

/** Dispatches an event to every matching listener in a snapshot chain,
 * child scope first then ancestors. All listeners run even when earlier
 * ones throw; failures are aggregated into EventEmitError after dispatch
 * completes. */
export async function dispatchEvent(
  chain: readonly ListenerScopeView[],
  event: KernelEvent,
): Promise<void> {
  const failures: ListenerFailure[] = [];
  for (const scope of chain) {
    for (const registration of scope.listeners) {
      const { contribution } = registration;
      if (!contribution.eventTypes.includes(event.type as KernelEventType)) {
        continue;
      }
      try {
        await contribution.handle(event);
      } catch (err) {
        failures.push({ listenerId: contribution.id, error: err });
      }
    }
  }
  if (failures.length > 0) {
    throw new EventEmitError(event.type, failures);
  }
}
