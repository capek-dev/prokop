/** Text that should be returned to the language model after a tool call. */
export interface ToolModelTextPart {
  type: 'text';
  text: string;
}

/** Base64-encoded image data that the language model should inspect. */
export interface ToolModelImagePart {
  type: 'image';
  data: string;
  mediaType: string;
}

/** Model-facing content supplied by a tool independently of its client result. */
export type ToolModelOutputPart = ToolModelTextPart | ToolModelImagePart;
