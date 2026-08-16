import { describe, expect, test } from 'bun:test';
import { DefaultAgentDriver } from '../src/runtime/default-agent-driver';

describe('C7 runtime boundary', () => {
  test('default driver is constructible without optional domain plugins', () => {
    expect(new DefaultAgentDriver()).toBeInstanceOf(DefaultAgentDriver);
  });
});
