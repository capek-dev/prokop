import type {
  CreateModelRequest,
  CreatePromptRequest,
  ModelsConfigResponse,
  Preconfig,
  PromptInfo,
  SetDefaultsRequest,
  SyncResult,
  UpdateModelRequest,
  UpdatePromptRequest,
} from '@prokopai/sdk';

export interface ModelsConfigurationPort {
  getModelsConfigWithStatus(): ModelsConfigResponse;
  createModel(providerId: string, data: CreateModelRequest): Promise<unknown>;
  updateModel(providerId: string, modelId: string, data: UpdateModelRequest): Promise<unknown>;
  deleteModel(providerId: string, modelId: string): Promise<unknown>;
  setDefaults(data: SetDefaultsRequest): Promise<unknown>;
  syncModels(mode: 'merge' | 'override'): Promise<SyncResult>;
}

export interface PromptsConfigurationPort {
  listPromptConfigs(): Promise<PromptInfo[]>;
  getPromptConfig(name: string): Promise<PromptInfo>;
  createPromptConfig(data: CreatePromptRequest): Promise<PromptInfo>;
  updatePromptConfig(name: string, data: UpdatePromptRequest): Promise<PromptInfo>;
  deletePromptConfig(name: string): Promise<void>;
  listPrompts(): Promise<PromptInfo[]>;
}

export type CreatePreconfigInput = Omit<Preconfig, 'id'> & { id?: string };
export type UpdatePreconfigInput = Partial<Omit<Preconfig, 'id'>>;

export interface PreconfigsConfigurationPort {
  listValidatedPreconfigs(): Promise<Preconfig[]>;
  createValidatedPreconfig(data: CreatePreconfigInput, format?: 'json' | 'md'): Promise<Preconfig>;
  updateValidatedPreconfig(id: string, updates: UpdatePreconfigInput): Promise<Preconfig>;
  deleteValidatedPreconfig(id: string): Promise<void>;
}
