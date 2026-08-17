import { beforeEach, describe, expect, test } from 'bun:test';
import { createRuntime } from '@/bootstrap/create-runtime';
import { buildStreamConfig } from '@capekai/core/internal/execution';

describe('buildStreamConfig provider options', () => {
  beforeEach(() => createRuntime());
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
