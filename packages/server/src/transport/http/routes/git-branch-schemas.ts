import { z } from 'zod';
const root = z.string().min(1).refine((value) => !value.includes('\0')).optional();
const head = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
const name = z.string().min(1).max(1024).refine((value) => !value.startsWith('-') && !/[\0\r\n]/.test(value));
const remote = z.string().max(1024).regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/);
const remoteRef = z.string().min(1).max(1024).refine((value) => value.startsWith('refs/remotes/') && !/[\0\r\n]/.test(value));
export const gitHistorySchema = z.object({ root, head, offset: z.number().int().min(0).max(100000), upstream: remoteRef.nullable().optional() }).strict();
export const gitCommitDetailsSchema = z.object({ root, head }).strict();
export const gitBranchPushReviewSchema = z.object({ root, sourceBranch: name, expectedHead: head, remote, branch: name }).strict();
export const gitBranchActionSchema = z.discriminatedUnion('action', [
  z.object({ root, action: z.literal('fetch'), remote }).strict(),
  z.object({ root, action: z.literal('pull'), expectedBranch: name, expectedHead: head, remote, branch: name }).strict(),
  z.object({ root, action: z.literal('pull-branch'), name, expectedHead: head }).strict(),
  z.object({ root, action: z.literal('create'), name, startHead: head }).strict(),
  z.object({ root, action: z.literal('track'), remote, branch: name, name, expectedHead: head }).strict(),
  z.object({ root, action: z.literal('switch'), name, expectedBranch: name.nullable(), expectedHead: head.nullable(), targetHead: head }).strict(),
  gitBranchPushReviewSchema.extend({ action: z.literal('push'), expectedRemoteHead: head.nullable(), force: z.boolean() }).strict(),
]);
