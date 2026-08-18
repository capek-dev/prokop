/**
 * Workflow tool types — the map-reduce pattern for multi-agent orchestration.
 *
 * The workflow tool decomposes a task into parallel subtasks, fans them out
 * to leaf agents concurrently, and synthesizes the results into one answer.
 */

/** A single subtask within a workflow. */
export interface WorkflowSubtask {
  /** The specific prompt for this subtask. */
  prompt: string;

  /** Optional preconfig override (by ID) for this specific subtask. */
  preconfigId?: string;

  /** Optional JSON Schema for this subtask's structured output. */
  outputSchema?: Record<string, unknown>;
}

/** Input parameters for the workflow tool. */
export interface WorkflowInput {
  /** The high-level task to accomplish. Always required. */
  prompt: string;

  /** Short label for the workflow run (shown in UI / session tree). */
  description?: string;

  /**
   * Explicit subtasks to run in parallel.
   * If provided, decomposition is SKIPPED.
   * If omitted, the tool decomposes the prompt via an isolated LLM call.
   */
  subtasks?: WorkflowSubtask[];

  /**
   * The preconfig to use for ALL leaf agents.
   * Overrides per-subtask assignments from the decomposer.
   */
  leafPreconfigId?: string;

  /**
   * Optional JSON Schema for the final synthesized output.
   * If provided, the synthesizer produces structured JSON.
   * If omitted, the synthesizer returns free text.
   */
  outputSchema?: Record<string, unknown>;
}

/** Result from the workflow tool. */
export interface WorkflowResult {
  /** The workflow run's unique ID (for logging/debugging). */
  workflow_id: string;

  /** The synthesized result — free text or text representation of structured output. */
  result: string;

  /** Structured JSON result, present only when outputSchema was provided. */
  structuredResult?: Record<string, unknown>;

  /** Number of subtasks that were executed. */
  subtaskCount: number;

  /** Error message if the workflow failed entirely. */
  error?: string;
}
