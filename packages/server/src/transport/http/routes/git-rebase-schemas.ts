import { z } from 'zod';
const root = z.string().min(1).optional();
const sha = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const token = z.string().regex(/^[a-f0-9]{64}$/);
const path = z.string().min(1).max(4096).refine((value) => !value.includes('\0'));
export const gitRebaseQuerySchema = z.object({ root }).strict();
export const gitRebaseConflictSchema = z.object({ root, path }).strict();
export const gitRebaseStartSchema = z.object({ root, expectedBranch: z.string().min(1).max(1024), expectedHead: sha, baseBranch: z.string().min(1).max(1024), baseHead: sha }).strict();
export const gitRebaseControlSchema = z.object({ root, token, action: z.enum(['continue', 'abort']) }).strict();
export const gitRebaseResolveSchema = z.discriminatedUnion('resolution', [
  z.object({ root, path, token, resolution: z.literal('text'), text: z.string().max(1024 * 1024) }).strict(),
  z.object({ root, path, token, resolution: z.enum(['base', 'feature', 'delete']) }).strict(),
]);
