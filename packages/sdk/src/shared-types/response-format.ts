// ===========================================
// Response Format Types
// ===========================================

/**
 * A saved response format that constrains the LLM to produce
 * structured output matching a JSON Schema.
 */
export interface ResponseFormat {
  id: string;
  name: string;
  description?: string;
  /** JSON Schema object that the response must conform to */
  schema: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

/**
 * Lightweight reference passed from client to server
 * to request structured output for a specific message.
 */
export interface ResponseFormatRef {
  id: string;
  name: string;
}
