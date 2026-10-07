import * as models from '@/config/models';
import * as modelsSync from '@/config/models-sync';
import * as prompts from '@/config/prompts';
import * as preconfigs from '@/config/preconfigs';
import { listPrompts } from '@/config/prompts-registry';
import type {
  ModelsConfigurationPort,
  PreconfigsConfigurationPort,
  PromptsConfigurationPort,
} from '@/application/ports/configuration';

export function createProkopConfigurationPorts(): {
  models: ModelsConfigurationPort;
  prompts: PromptsConfigurationPort;
  preconfigs: PreconfigsConfigurationPort;
} {
  return {
    models: {
      getModelsConfigWithStatus: models.getModelsConfigWithStatus,
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
