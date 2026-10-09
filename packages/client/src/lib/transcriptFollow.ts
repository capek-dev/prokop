/** Same fraction LegendList uses for `maintainScrollAtEndThreshold`. */
export const FOLLOW_END_THRESHOLD = 0.1;

/** Scroll events this soon after wheel, touch, key or pointer input are the user's. */
export const USER_SCROLL_INPUT_WINDOW_MS = 300;

/** Where the reader was in free mode: a message and the pixels scrolled into it. */
export interface TranscriptAnchor {
  messageId: string;
  offset: number;
}

export interface ScrollSample {
  scrollTop: number;
  previousScrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  userDriven: boolean;
}

export function isAtTranscriptEnd(sample: Pick<ScrollSample, 'scrollTop' | 'scrollHeight' | 'clientHeight'>): boolean {
  const distance = sample.scrollHeight - sample.scrollTop - sample.clientHeight;
  return distance <= Math.max(1, sample.clientHeight * FOLLOW_END_THRESHOLD);
}

/**
 * Decides follow mode from how a scroll moved the view, not from which
 * input caused it, so scrollbar drags, keys, text selection and wheel all
 * behave the same. Returns the new mode, or null to keep the current one.
 *
 * - Any upward scroll by the user stops following, even a few pixels
 *   inside the end region; waiting for it to leave that region is what
 *   made fast streams pull the view back down.
 * - A jump up of more than half a screen without input (find in page,
 *   anchor links) also stops following.
 * - Scrolling down into the end region by the user resumes following.
 *
 * List corrections never trigger a change: they either scroll down to the
 * end or, when content above shrinks, are clamped at the end.
 */
export function decideFollow(sample: ScrollSample, following: boolean): boolean | null {
  const movedUp = sample.scrollTop < sample.previousScrollTop - 1;
  const distanceFromEnd = sample.scrollHeight - sample.scrollTop - sample.clientHeight;

  if (following) {
    if (!movedUp || distanceFromEnd <= 1) return null;
    const jumpedUp = sample.previousScrollTop - sample.scrollTop > sample.clientHeight / 2;
    return sample.userDriven || jumpedUp ? false : null;
  }

  const movedDown = sample.scrollTop > sample.previousScrollTop;
  return sample.userDriven && movedDown && isAtTranscriptEnd(sample) ? true : null;
}

/** Wheel input that scrolls up rather than sideways (trackpad swipes carry a little of both). */
export function isUpwardWheel(deltaX: number, deltaY: number): boolean {
  return deltaY < 0 && Math.abs(deltaY) > Math.abs(deltaX);
}

export function isUpwardScrollKey(key: string, shiftKey: boolean): boolean {
  return key === 'ArrowUp' || key === 'PageUp' || key === 'Home' || (key === ' ' && shiftKey);
}

/**
 * True when a wheel starting at `target` scrolls a nested element (a tall
 * tool output, a structured response) instead of the transcript.
 */
export function nestedScrollerTakesWheelUp(target: EventTarget | null, root: HTMLElement): boolean {
  let element = target instanceof Element ? target : null;
  while (element && element !== root) {
    if (element instanceof HTMLElement && element.scrollTop > 0 && element.scrollHeight > element.clientHeight) {
      const { overflowY } = getComputedStyle(element);
      if (overflowY === 'auto' || overflowY === 'scroll') return true;
    }
    element = element.parentElement;
  }
  return false;
}
