import type {
  ModelsConfigurationPort,
  PreconfigsConfigurationPort,
  PromptsConfigurationPort,
} from '../ports/configuration';

export interface ConfigurationApplication {
  models: ModelsConfigurationPort;
  prompts: PromptsConfigurationPort;
  preconfigs: PreconfigsConfigurationPort;
}

export interface ConfigurationApplicationDeps {
  models: ModelsConfigurationPort;
  prompts: PromptsConfigurationPort;
  preconfigs: PreconfigsConfigurationPort;
}

export function createConfigurationApplication(
  deps: ConfigurationApplicationDeps,
): ConfigurationApplication {
  return {
    models: deps.models,
    prompts: deps.prompts,
    preconfigs: deps.preconfigs,
  };
}
