import { describe, expect, test } from 'vitest';
import { decideFollow, isAtTranscriptEnd, isUpwardScrollKey, isUpwardWheel } from '@/lib/transcriptFollow';
import type { ScrollSample } from '@/lib/transcriptFollow';

// 1000px of content in a 400px viewport: the end is scrollTop 600, and the
// end region is the last 40px (10% of the viewport).
function sample(scrollTop: number, overrides: Partial<ScrollSample> = {}): ScrollSample {
  return { scrollTop, previousScrollTop: 600, scrollHeight: 1000, clientHeight: 400, userDriven: false, ...overrides };
}

describe('isAtTranscriptEnd', () => {
  test('treats the last tenth of a screen as the end', () => {
    expect(isAtTranscriptEnd(sample(600))).toBe(true);
    expect(isAtTranscriptEnd(sample(560))).toBe(true);
    expect(isAtTranscriptEnd(sample(559))).toBe(false);
  });
});

describe('decideFollow', () => {
  test('any user scroll that leaves the end stops following, whatever the input', () => {
    expect(decideFollow(sample(500, { userDriven: true }), true)).toBe(false);
  });

  test('scrolls the user did not cause keep following, so list corrections cannot break it', () => {
    expect(decideFollow(sample(500), true)).toBeNull();
  });

  test('a jump of more than half a screen up without input, like find in page, stops following', () => {
    expect(decideFollow(sample(100, { previousScrollTop: 600 }), true)).toBe(false);
  });

  test('reaching the end by the user resumes following; a programmatic arrival does not', () => {
    expect(decideFollow(sample(600, { previousScrollTop: 300, userDriven: true }), false)).toBe(true);
    expect(decideFollow(sample(600, { previousScrollTop: 300 }), false)).toBeNull();
  });

  test('scrolling within free mode changes nothing', () => {
    expect(decideFollow(sample(200, { previousScrollTop: 300, userDriven: true }), false)).toBeNull();
  });

  test('a small user scroll up inside the end region already stops following', () => {
    // One wheel notch during a fast stream; waiting for the region edge caused the tug of war.
    expect(decideFollow(sample(580, { userDriven: true }), true)).toBe(false);
  });

  test('scrolling up inside the end region in free mode does not resume following', () => {
    expect(decideFollow(sample(570, { previousScrollTop: 590, userDriven: true }), false)).toBeNull();
  });

  test('content shrinking above while at the end clamps the view and keeps following', () => {
    expect(decideFollow(sample(500, { scrollHeight: 900, userDriven: true }), true)).toBeNull();
  });
});

describe('upward intent', () => {
  test('a mostly sideways trackpad swipe is not an upward wheel', () => {
    expect(isUpwardWheel(0, -40)).toBe(true);
    expect(isUpwardWheel(120, -2)).toBe(false);
    expect(isUpwardWheel(0, 40)).toBe(false);
  });

  test('keys that scroll up', () => {
    expect(['ArrowUp', 'PageUp', 'Home'].every(key => isUpwardScrollKey(key, false))).toBe(true);
    expect(isUpwardScrollKey(' ', true)).toBe(true);
    expect(isUpwardScrollKey(' ', false)).toBe(false);
    expect(isUpwardScrollKey('ArrowDown', false)).toBe(false);
  });
});
