import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { configureCapekJean2Compatibility } from '@/capek-adapter';
import { getModelWithMetadata } from '@/core/model-utils';
import { activateSandbox, deactivateSandbox } from '@/sandbox';
import { SandboxLanguageModel } from '@/sandbox/model';

const originalOpenAIApiKey = process.env.JEAN2_LLM_OPENAI_API_KEY;

beforeEach(() => {
  configureCapekJean2Compatibility();
});

afterEach(() => {
  deactivateSandbox();
  if (originalOpenAIApiKey === undefined) {
    delete process.env.JEAN2_LLM_OPENAI_API_KEY;
  } else {
    process.env.JEAN2_LLM_OPENAI_API_KEY = originalOpenAIApiKey;
  }
});

describe('getModelWithMetadata', () => {
  test('routes the main model path through sandbox when active', async () => {
    activateSandbox();

    const result = await getModelWithMetadata({
      modelId: 'any-model',
      providerId: 'openai',
      sessionId: 'main-session',
    });

    expect(result.model).toBeInstanceOf(SandboxLanguageModel);
    expect(result.omitMaxOutputTokens).toBe(true);
  });

  test('uses the OpenAI Responses connector with local storage disabled', async () => {
    process.env.JEAN2_LLM_OPENAI_API_KEY = 'test-key';

    const result = await getModelWithMetadata({
      modelId: 'gpt-5.6-luna',
      providerId: 'openai',
    });

    expect(typeof result.model).toBe('object');
    if (typeof result.model !== 'object') {
      throw new Error('Expected an AI SDK language model instance');
    }
    expect(result.model.provider).toBe('openai.responses');
    expect(result.providerOptions).toEqual({
      openai: {
        store: false,
      },
    });
    expect(result.providerOptions?.openai).not.toHaveProperty('forceReasoning');
  });
});
