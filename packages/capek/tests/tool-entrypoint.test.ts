import { describe, expect, test } from 'bun:test';
import {
  SENSITIVE_FILE_PATTERNS,
  createOutsideWorkspaceAsk,
} from '@capekai/core/tool';
import type {
  AskApi as CapekAskApi,
  EnvApi as CapekEnvApi,
  FileSystemApi as CapekFileSystemApi,
  LlmApi as CapekLlmApi,
  ToolContext as CapekToolContext,
  ToolDefinition as CapekToolDefinition,
  ToolLogger as CapekToolLogger,
  ToolModule as CapekToolModule,
  ToolResult as CapekToolResult,
} from '@capekai/core/tool';
import type {
  AskApi as SdkAskApi,
  EnvApi as SdkEnvApi,
  FileSystemApi as SdkFileSystemApi,
  LlmApi as SdkLlmApi,
  ToolContext as SdkToolContext,
  ToolDefinition as SdkToolDefinition,
  ToolLogger as SdkToolLogger,
  ToolModule as SdkToolModule,
  ToolResult as SdkToolResult,
} from '@capekai/tool';

type Assert<T extends true> = T;
type IsAssignable<From, To> = [From] extends [To] ? true : false;
type Bidirectional<Left, Right> = IsAssignable<Left, Right> extends true
  ? IsAssignable<Right, Left>
  : false;

type ToolDefinitionCompatibility = Assert<Bidirectional<CapekToolDefinition, SdkToolDefinition>>;
type ToolResultCompatibility = Assert<Bidirectional<CapekToolResult, SdkToolResult>>;
type ToolModuleCompatibility = Assert<Bidirectional<CapekToolModule, SdkToolModule>>;
type ToolContextCompatibility = Assert<Bidirectional<CapekToolContext, SdkToolContext>>;
type FileSystemCompatibility = Assert<Bidirectional<CapekFileSystemApi, SdkFileSystemApi>>;
type LlmCompatibility = Assert<Bidirectional<CapekLlmApi, SdkLlmApi>>;
type AskCompatibility = Assert<Bidirectional<CapekAskApi, SdkAskApi>>;
type EnvCompatibility = Assert<Bidirectional<CapekEnvApi, SdkEnvApi>>;
type LoggerCompatibility = Assert<Bidirectional<CapekToolLogger, SdkToolLogger>>;

const compatibilityAssertions: [
  ToolDefinitionCompatibility,
  ToolResultCompatibility,
  ToolModuleCompatibility,
  ToolContextCompatibility,
  FileSystemCompatibility,
  LlmCompatibility,
  AskCompatibility,
  EnvCompatibility,
  LoggerCompatibility,
] = [true, true, true, true, true, true, true, true, true];

describe('@capekai/core/tool', () => {
  test('imports the declared authoring subpath by package name', () => {
    expect(compatibilityAssertions).toEqual([true, true, true, true, true, true, true, true, true]);
    expect(SENSITIVE_FILE_PATTERNS.length).toBeGreaterThan(0);
    expect(typeof createOutsideWorkspaceAsk).toBe('function');
  });

  test('does not export Jean2 client or transport APIs', async () => {
    const authoring = await import('@capekai/core/tool');

    expect(authoring).not.toHaveProperty('ProkopaiClient');
    expect(authoring).not.toHaveProperty('WebSocketTransport');
    expect(authoring).not.toHaveProperty('HttpClient');
    expect(authoring).not.toHaveProperty('SessionsRestNamespace');
    expect(authoring).not.toHaveProperty('createWorkspaceCapability');
    expect(authoring).not.toHaveProperty('executeTool');
    expect(authoring).not.toHaveProperty('getJean2CompatibilityBindings');
  });
});
