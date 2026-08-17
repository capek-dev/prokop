import type { Database } from 'bun:sqlite';
import type { ResponseFormat } from '@jean2/sdk';
import { getDatabase } from './database';

interface ResponseFormatRow {
  id: string;
  name: string;
  description: string | null;
  schema: string;
  created_at: number;
  updated_at: number;
}

function rowToResponseFormat(row: ResponseFormatRow): ResponseFormat {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    schema: JSON.parse(row.schema) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createResponseFormat(format: {
  id: string;
  name: string;
  description?: string;
  schema: Record<string, unknown>;
}): ResponseFormat {
  const db = getDatabase();
  const now = Date.now();
  db.run(
    `INSERT INTO response_formats (id, name, description, schema, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [format.id, format.name, format.description ?? null, JSON.stringify(format.schema), now, now],
  );
  return getResponseFormat(format.id)!;
}

export function getResponseFormat(id: string): ResponseFormat | null {
  const row = getDatabase().query('SELECT * FROM response_formats WHERE id = ?').get(id) as ResponseFormatRow | undefined;
  return row ? rowToResponseFormat(row) : null;
}

export function listResponseFormats(): ResponseFormat[] {
  const rows = getDatabase().query('SELECT * FROM response_formats ORDER BY name ASC').all() as ResponseFormatRow[];
  return rows.map(rowToResponseFormat);
}

export function updateResponseFormat(
  id: string,
  updates: { name?: string; description?: string; schema?: Record<string, unknown> },
): ResponseFormat | null {
  const db = getDatabase();
  const existing = getResponseFormat(id);
  if (!existing) return null;
  const now = Date.now();
  db.run(
    `UPDATE response_formats SET name = ?, description = ?, schema = ?, updated_at = ? WHERE id = ?`,
    [
      updates.name ?? existing.name,
      updates.description !== undefined ? updates.description : (existing.description ?? null),
      updates.schema ? JSON.stringify(updates.schema) : JSON.stringify(existing.schema),
      now,
      id,
    ],
  );
  return getResponseFormat(id);
}

export function deleteResponseFormat(id: string): boolean {
  return getDatabase().run('DELETE FROM response_formats WHERE id = ?', [id]).changes > 0;
}

const BUILTIN_FORMATS: Array<{
  id: string;
  name: string;
  description: string;
  schema: Record<string, unknown>;
}> = [{
  id: 'builtin-yesno',
  name: 'Yes / No',
  description: 'A simple yes or no answer',
  schema: {
    type: 'object',
    properties: {
      answer: { type: 'boolean', description: 'Yes (true) or No (false)' },
      reasoning: { type: 'string', description: 'Brief explanation for the answer' },
    },
    required: ['answer', 'reasoning'],
    additionalProperties: false,
  },
}];

export function seedBuiltinResponseFormats(database?: Database): void {
  const db = database ?? getDatabase();
  const now = Date.now();
  for (const format of BUILTIN_FORMATS) {
    if (!db.query('SELECT id FROM response_formats WHERE id = ?').get(format.id)) {
      db.run(
        `INSERT INTO response_formats (id, name, description, schema, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [format.id, format.name, format.description, JSON.stringify(format.schema), now, now],
      );
    }
  }
}
