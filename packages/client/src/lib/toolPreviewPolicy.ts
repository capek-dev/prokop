import type { Message } from '@prokopai/sdk';
import { RENDER_BUDGETS } from './renderBudgets';

interface PreviewItem {
  message: Message;
  isQueued?: boolean;
}

/** Input is transcript order. Queued prompts have not started a new turn yet. */
export function getToolPreviewCutoff(items: readonly PreviewItem[]): number {
  let prompts = 0;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (!items[index].isQueued && items[index].message.role === 'user') {
      prompts += 1;
      if (prompts === RENDER_BUDGETS.toolPreviewRecentPrompts) return index;
    }
  }
  // A partial page without two prompts cannot establish an older turn boundary.
  return 0;
}
