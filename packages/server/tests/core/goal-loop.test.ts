import { describe, expect, test } from 'bun:test';
import { buildContinuationMessage } from '@capekai/core/compat/jean2';

describe('goal continuation', () => {
  test('preserves evaluator reason and remaining work', () => {
    const message = buildContinuationMessage(
      'all focused tests pass',
      'one test still fails',
      'fix the queue assertion',
    );

    expect(message).toContain('The goal is NOT yet met: all focused tests pass');
    expect(message).toContain('Evaluator feedback: one test still fails');
    expect(message).toContain('Remaining work: fix the queue assertion');
    expect(message).toContain('Continue working toward the goal.');
  });
});
