export type PreconfigMode = 'primary' | 'subagent' | 'both';

export interface Preconfig {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  tools: string[] | null;
  model: string | null;
  provider: string | null;
  variant?: string | null;
  settings: Record<string, unknown> | null;
  isDefault: boolean;
  mode?: PreconfigMode; // Default: 'primary'
  /**
   * Controls which subagents this preconfig can spawn via the Task tool.
   * - undefined: All available subagents (default for backward compatibility)
   * - true: All available subagents
   * - false or null: Cannot spawn any subagents
   * - []: Cannot spawn any subagents
   * - ["explore", "code-planning"]: Can only spawn these specific subagent IDs
   */
  canSpawnSubagents?: boolean | string[] | null;
  /**
   * Allows one immediate self-delegation when subagent spawning is enabled.
   * Defaults to false. The same preconfig can never repeat later in the ancestry chain.
   */
  allowSelfAsSubagent?: boolean;
  /**
   * Controls which skills this preconfig can access.
   * - undefined or null: All available skills (default for backward compatibility)
   * - []: No skills available
   * - ["skill-name", ...]: Only these named skills available
   */
  skills?: string[] | null;
}
