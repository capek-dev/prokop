import { registerProvider, sandboxController, SandboxProvider, type AutoResponderRule, type SandboxControlEvent } from '@/adapters/capek/contracts';

const defaultAutoResponderRules: AutoResponderRule[] = [
  {
    label: 'Auto-respond generate calls',
    match: { mode: 'generate' },
    response: { type: 'text', content: 'Summary of the conversation so far.' },
  },
];

let active = false;

export function activateSandbox(
  broadcastFn?: (event: SandboxControlEvent) => void,
): void {
  if (active) {
    if (broadcastFn) {
      sandboxController.setBroadcast(broadcastFn);
    }
    return;
  }

  active = true;
  registerProvider(new SandboxProvider());
  sandboxController.setAutoResponderRules(defaultAutoResponderRules);
  sandboxController.clearHistory();

  if (broadcastFn) {
    sandboxController.setBroadcast(broadcastFn);
  }

  console.log('[Sandbox] Activated: all LLM calls will be intercepted');
}

export function deactivateSandbox(): void {
  active = false;
  sandboxController.reset();
}

export function isSandboxActive(): boolean {
  return active;
}
