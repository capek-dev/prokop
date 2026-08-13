import { beforeEach, describe, expect, test } from 'bun:test';
import { configureCapekJean2Compatibility } from '@/capek-adapter';
import { buildStreamConfig } from '@/core/stream/stream-config';

describe('buildStreamConfig provider options', () => {
  beforeEach(() => configureCapekJean2Compatibility());
  test('preserves OpenAI connector defaults when merging a reasoning variant', () => {
    const result = buildStreamConfig({
      modelId: 'gpt-5.6-luna',
      providerId: 'openai',
      variant: 'max',
      systemMessage: 'System prompt',
      baseProviderOptions: {
        openai: {
          store: false,
        },
      },
    });

    expect(result.providerOptions).toEqual({
      openai: {
        store: false,
        reasoningEffort: 'max',
        reasoningSummary: 'auto',
        include: ['reasoning.encrypted_content'],
      },
    });
    expect(result.providerOptions?.openai).not.toHaveProperty('forceReasoning');
  });
});
