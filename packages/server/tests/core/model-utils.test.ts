import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createRuntime } from '@/bootstrap/create-runtime';
import { getModelWithMetadata } from '@capekai/core/execution';
import {
  configureRuntimeConfiguration,
  getRuntimeConfiguration,
} from '@capekai/core/configuration';
import { SandboxLanguageModel } from '@capekai/core/sandbox';
import { activateSandbox, deactivateSandbox } from '@/infrastructure/sandbox';

let originalRuntimeConfiguration: ReturnType<typeof getRuntimeConfiguration>;

beforeEach(() => {
  createRuntime();
  originalRuntimeConfiguration = getRuntimeConfiguration();
});

afterEach(() => {
  deactivateSandbox();
  configureRuntimeConfiguration(originalRuntimeConfiguration);
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
    configureRuntimeConfiguration({
      ...getRuntimeConfiguration(),
      getApiKey: (providerId) => providerId === 'openai' ? 'test-key' : undefined,
    });

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
