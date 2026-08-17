export interface ResponseFormat {
  id: string;
  name: string;
  description?: string;
  schema: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface ResponseFormatInput {
  id: string;
  name: string;
  description?: string;
  schema: Record<string, unknown>;
}

export interface ResponseFormatsApplication {
  list(): ResponseFormat[];
  get(id: string): ResponseFormat | null;
  create(input: ResponseFormatInput): ResponseFormat;
  update(id: string, updates: Partial<Omit<ResponseFormatInput, 'id'>>): ResponseFormat | null;
  delete(id: string): boolean;
}
