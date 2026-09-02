import type { Hono } from 'hono';
import { validate } from './validate';
import type { ConfigurationApplication } from '@/application/config';
import type { ProvidersApplication } from '@/application/providers';
import {
  createPreconfigSchema,
  updatePreconfigSchema,
  providerConnectSchema,
  oauthCallbackSchema,
  providerCredentialsSchema,
  modelsSyncSchema,
  createPromptSchema,
  updatePromptSchema,
  looseObjectSchema,
} from './schemas';

export function registerConfigRoutes(
  app: Hono,
  providers: ProvidersApplication,
  configuration: ConfigurationApplication,
): void {
  // ============================================================================
  // Preconfigs API (validated)
  // ============================================================================

  app.get('/api/preconfigs', async (c) => {
    const preconfigs = await configuration.preconfigs.listValidatedPreconfigs();
    return c.json({ preconfigs });
  });

  app.post(
    '/api/preconfigs',
    validate('json', createPreconfigSchema),
    async (c) => {
      const body = c.req.valid('json');
      const format = body.format === 'md' ? 'md' : undefined;
      const preconfig = await configuration.preconfigs.createValidatedPreconfig({
        id: body.id,
        name: body.name || 'Custom Preconfig',
        description: body.description || '',
        systemPrompt: body.systemPrompt || '',
        tools: body.tools ?? null,
        model: body.model ?? null,
        provider: body.provider ?? null,
        variant: body.variant ?? null,
        settings: body.settings ?? null,
        isDefault: false,
        mode: body.mode as 'primary' | 'subagent' | 'both' | undefined,
        canSpawnSubagents: body.canSpawnSubagents as boolean | string[] | undefined,
        allowSelfAsSubagent: body.allowSelfAsSubagent,
        skills: body.skills ?? null,
      }, format);
      return c.json({ preconfig }, 201);
    },
  );

  app.get('/api/preconfigs/:id', async (c) => {
    const id = c.req.param('id');
    const preconfig = await configuration.preconfigs.listValidatedPreconfigs()
      .then(ps => ps.find(p => p.id === id));
    if (!preconfig) {
      return c.json({ error: 'not_found', message: 'Preconfig not found' }, 404);
    }
    return c.json({ preconfig });
  });

  app.put(
    '/api/preconfigs/:id',
    validate('json', updatePreconfigSchema),
    async (c) => {
      const id = c.req.param('id');
      const body = c.req.valid('json');
      const preconfig = await configuration.preconfigs.updateValidatedPreconfig(id, {
        name: body.name,
        description: body.description,
        systemPrompt: body.systemPrompt,
        tools: body.tools,
        model: body.model,
        provider: body.provider,
        variant: body.variant,
        settings: body.settings,
        isDefault: body.isDefault as boolean | undefined,
        mode: body.mode as 'primary' | 'subagent' | 'both' | undefined,
        canSpawnSubagents: body.canSpawnSubagents as boolean | string[] | null | undefined,
        ...(body.allowSelfAsSubagent !== undefined
          ? { allowSelfAsSubagent: body.allowSelfAsSubagent }
          : {}),
        skills: body.skills,
      });
      return c.json({ preconfig });
    },
  );

  app.delete('/api/preconfigs/:id', async (c) => {
    const id = c.req.param('id');
    await configuration.preconfigs.deleteValidatedPreconfig(id);
    return c.json({ success: true });
  });

  // ============================================================================
  // Prompts API
  // ============================================================================

  app.get('/api/prompts', async (c) => {
    try {
      const prompts = await configuration.prompts.listPrompts();
      return c.json({ prompts });
    } catch (_error) {
      return c.json({ prompts: [] });
    }
  });

  // ============================================================================
  // Models API
  // ============================================================================

  app.get('/api/models', async (c) => {
    try {
      const configResponse = configuration.models.getModelsConfigWithStatus();
      const models = configResponse.providers.flatMap((provider) => provider.models);
      return c.json({
        models,
        defaultModel: configResponse.defaultModel,
        defaultProvider: configResponse.defaultProvider,
      });
    } catch (_error) {
      return c.json({ models: [], error: 'Failed to load models' });
    }
  });

  // ============================================================================
  // Providers API
  // ============================================================================

  app.get('/api/providers', async (c) => {
    const providerStatuses = providers.list();
    return c.json({ providers: providerStatuses });
  });

  app.post(
    '/api/providers/:providerId/connect',
    validate('json', providerConnectSchema),
    async (c) => {
      const providerId = c.req.param('providerId');
      const body = c.req.valid('json');
      const { result, status } = await providers.connect(providerId, {
        redirectStrategy: body.redirectStrategy,
      });
      return c.json({
        authorizationUrl: result.authorizationUrl,
        flowId: result.flowId,
        redirectStrategy: result.redirectStrategy,
        redirectUri: result.redirectUri,
        status,
      });
    },
  );

  app.get('/api/providers/:providerId/status', async (c) => {
    const providerId = c.req.param('providerId');
    const status = providers.status(providerId);
    return c.json({ status });
  });

  app.delete('/api/providers/:providerId', async (c) => {
    const providerId = c.req.param('providerId');
    await providers.disconnect(providerId);
    return c.json({ success: true });
  });

  app.post(
    '/api/oauth/callback',
    validate('json', oauthCallbackSchema),
    async (c) => {
      const body = c.req.valid('json');
      const result = await providers.completeOAuth(
        body.flowId,
        body.code,
        body.state ?? '',
        body.redirectUri ?? '',
      );
      return c.json({ success: true, provider: result.providerId });
    },
  );

  app.get('/api/providers/:providerId/oauth/callback', async (c) => {
    const providerId = c.req.param('providerId');
    const url = new URL(c.req.url);
    const result = await providers.serverCallback(providerId, url);
    return new Response(result.body, {
      status: result.status,
      headers: { 'Content-Type': result.contentType },
    });
  });

  // ============================================================================
  // Configuration: Provider Credentials
  // ============================================================================

  app.get('/api/config/providers', (c) => {
    const result = providers.listCredentials();
    return c.json(result);
  });

  app.put(
    '/api/config/providers/:provider',
    validate('json', providerCredentialsSchema),
    async (c) => {
      const provider = c.req.param('provider');
      const body = c.req.valid('json');
      const result = await providers.setCredential(provider, body.apiKey ?? '');
      return c.json(result);
    },
  );

  app.delete('/api/config/providers/:provider', async (c) => {
    const provider = c.req.param('provider');
    const result = await providers.clearCredential(provider);
    return c.json(result);
  });

  // ============================================================================
  // Configuration: Models
  // ============================================================================

  app.get('/api/config/models', (c) => {
    const result = configuration.models.getModelsConfigWithStatus();
    return c.json(result);
  });

  app.post(
    '/api/config/models/providers',
    validate('json', looseObjectSchema),
    async (c) => {
      const body = c.req.valid('json');
      const result = await configuration.models.createProvider(body as never);
      return c.json(result, 201);
    },
  );

  app.put(
    '/api/config/models/providers/:providerId',
    validate('json', looseObjectSchema),
    async (c) => {
      const providerId = c.req.param('providerId');
      const body = c.req.valid('json');
      const result = await configuration.models.updateProvider(providerId, body);
      return c.json(result);
    },
  );

  app.delete('/api/config/models/providers/:providerId', async (c) => {
    const providerId = c.req.param('providerId');
    const result = await configuration.models.deleteProvider(providerId);
    return c.json(result);
  });

  app.post(
    '/api/config/models/providers/:providerId/models',
    validate('json', looseObjectSchema),
    async (c) => {
      const providerId = c.req.param('providerId');
      const body = c.req.valid('json');
      const result = await configuration.models.createModel(providerId, body as never);
      return c.json(result, 201);
    },
  );

  app.put(
    '/api/config/models/providers/:providerId/models/:modelId',
    validate('json', looseObjectSchema),
    async (c) => {
      const providerId = c.req.param('providerId');
      const modelId = c.req.param('modelId');
      const body = c.req.valid('json');
      const result = await configuration.models.updateModel(providerId, modelId, body);
      return c.json(result);
    },
  );

  app.delete('/api/config/models/providers/:providerId/models/:modelId', async (c) => {
    const providerId = c.req.param('providerId');
    const modelId = c.req.param('modelId');
    const result = await configuration.models.deleteModel(providerId, modelId);
    return c.json(result);
  });

  app.post(
    '/api/config/models/sync',
    validate('json', modelsSyncSchema),
    async (c) => {
      const body = c.req.valid('json');
      const mode = body.mode === 'override' ? 'override' as const : 'merge' as const;
      const result = await configuration.models.syncModels(mode);
      return c.json(result);
    },
  );

  app.put(
    '/api/config/models/defaults',
    validate('json', looseObjectSchema),
    async (c) => {
      const body = c.req.valid('json');
      const result = await configuration.models.setDefaults(body as never);
      return c.json(result);
    },
  );

  // ============================================================================
  // Configuration: Prompts
  // ============================================================================

  app.get('/api/config/prompts', async (c) => {
    const prompts = await configuration.prompts.listPromptConfigs();
    return c.json({ prompts });
  });

  app.get('/api/config/prompts/:name', async (c) => {
    const name = c.req.param('name');
    const prompt = await configuration.prompts.getPromptConfig(name);
    return c.json(prompt);
  });

  app.post(
    '/api/config/prompts',
    validate('json', createPromptSchema),
    async (c) => {
      const body = c.req.valid('json');
      const prompt = await configuration.prompts.createPromptConfig(body as never);
      return c.json(prompt, 201);
    },
  );

  app.put(
    '/api/config/prompts/:name',
    validate('json', updatePromptSchema),
    async (c) => {
      const name = c.req.param('name');
      const body = c.req.valid('json');
      const prompt = await configuration.prompts.updatePromptConfig(name, body as never);
      return c.json(prompt);
    },
  );

  app.delete('/api/config/prompts/:name', async (c) => {
    const name = c.req.param('name');
    await configuration.prompts.deletePromptConfig(name);
    return c.json({ success: true });
  });
}
