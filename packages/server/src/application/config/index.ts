import type {
  ModelsConfigurationPort,
  PreconfigsConfigurationPort,
  PromptsConfigurationPort,
} from '@/application/ports/configuration';

export interface ConfigurationApplication {
  models: ModelsConfigurationPort;
  prompts: PromptsConfigurationPort;
  preconfigs: PreconfigsConfigurationPort;
}

export interface ConfigurationApplicationDeps {
  models: ModelsConfigurationPort;
  prompts: PromptsConfigurationPort;
  preconfigs: PreconfigsConfigurationPort;
  /**
   * Post-save hook invoked after a successful preconfig create/update.
   * The bootstrap wires agent materialization here so primary/both
   * preconfigs become agents immediately; failures must be caught by the
   * hook itself so an otherwise-successful config write never fails.
   */
  onPreconfigSaved?: (preconfigId: string) => Promise<void>;
}

function withPreconfigSavedHook(
  preconfigs: PreconfigsConfigurationPort,
  onPreconfigSaved: ((preconfigId: string) => Promise<void>) | undefined,
): PreconfigsConfigurationPort {
  if (!onPreconfigSaved) return preconfigs;
  return {
    ...preconfigs,
    async createValidatedPreconfig(data, format) {
      const preconfig = await preconfigs.createValidatedPreconfig(data, format);
      await onPreconfigSaved(preconfig.id);
      return preconfig;
    },
    async updateValidatedPreconfig(id, updates) {
      const preconfig = await preconfigs.updateValidatedPreconfig(id, updates);
      await onPreconfigSaved(preconfig.id);
      return preconfig;
    },
  };
}

export function createConfigurationApplication(
  deps: ConfigurationApplicationDeps,
): ConfigurationApplication {
  return {
    models: deps.models,
    prompts: deps.prompts,
    preconfigs: withPreconfigSavedHook(deps.preconfigs, deps.onPreconfigSaved),
  };
}
