import * as models from '@/configuration/models';
import * as modelsSync from '@/configuration/models-sync';
import * as prompts from '@/configuration/prompts';
import * as preconfigs from '@/configuration/preconfigs';
import { listPrompts } from '@/prompts/registry';
import type {
  ModelsConfigurationPort,
  PreconfigsConfigurationPort,
  PromptsConfigurationPort,
} from '@/application/ports/configuration';

export function createJean2ConfigurationPorts(): {
  models: ModelsConfigurationPort;
  prompts: PromptsConfigurationPort;
  preconfigs: PreconfigsConfigurationPort;
} {
  return {
    models: {
      getModelsConfigWithStatus: models.getModelsConfigWithStatus,
      createProvider: models.createProvider,
      updateProvider: models.updateProvider,
      deleteProvider: models.deleteProvider,
      createModel: models.createModel,
      updateModel: models.updateModel,
      deleteModel: models.deleteModel,
      setDefaults: models.setDefaults,
      syncModels: modelsSync.syncModels,
    },
    prompts: {
      listPromptConfigs: prompts.listPromptConfigs,
      getPromptConfig: prompts.getPromptConfig,
      createPromptConfig: prompts.createPromptConfig,
      updatePromptConfig: prompts.updatePromptConfig,
      deletePromptConfig: prompts.deletePromptConfig,
      listPrompts,
    },
    preconfigs: {
      listValidatedPreconfigs: preconfigs.listValidatedPreconfigs,
      createValidatedPreconfig: preconfigs.createValidatedPreconfig,
      updateValidatedPreconfig: preconfigs.updateValidatedPreconfig,
      deleteValidatedPreconfig: preconfigs.deleteValidatedPreconfig,
    },
  };
}
