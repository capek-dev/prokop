import type { Hono } from 'hono';
import type { SessionStatus } from '@prokopai/sdk';
import { validate } from './validate';
import { createSessionSchema, updateSessionSchema } from './schemas';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  PayloadTooLargeError,
  UnauthorizedError,
} from '@/application/http-errors';
import type { SessionHttpApplication } from '@/application';

/**
 * HTTP session routes (S3).
 *
 * Route validation and HTTP presentation stay here. All session reads and
 * writes go through the injected session HTTP application use cases, which
 * orchestrate the repository port. This module imports neither the store nor
 * Capek implementations.
 */
export function registerSessionRoutes(app: Hono, application: SessionHttpApplication): void {
  app.get('/api/sessions', async (c) => {
    const status = c.req.query('status') as SessionStatus | undefined;
    const sessions = application.listSessions(status);
    return c.json({ sessions });
  });

  app.post(
    '/api/sessions',
    validate('json', createSessionSchema),
    async (c) => {
      const body = c.req.valid('json');
      const session = application.createSession({
        id: body.id,
        workspaceId: body.workspaceId,
        workspaceRootId: body.workspaceRootId,
        preconfigId: body.preconfigId,
        title: body.title,
        metadata: body.metadata,
      });
      if (!session) {
        throw new BadRequestError('Selected worktree is not available for this workspace');
      }
      return c.json({ session }, 201);
    },
  );

  app.get('/api/sessions/grouped', async (c) => {
    const workspaceIdsParam = c.req.query('workspaceIds');
    if (!workspaceIdsParam) {
      throw new BadRequestError('workspaceIds query parameter is required');
    }

    const workspaceIds = workspaceIdsParam.split(',').filter(Boolean);
    if (workspaceIds.length === 0) {
      throw new BadRequestError('At least one workspaceId is required');
    }

    const status = c.req.query('status') as SessionStatus | undefined;
    const rootOnly = c.req.query('rootOnly') === 'true';
    const limitPerWorkspaceParam = c.req.query('limitPerWorkspace');

    // When limitPerWorkspace is present, use bounded grouped pagination
    if (limitPerWorkspaceParam !== undefined) {
      const limitPerWorkspace = parseInt(limitPerWorkspaceParam, 10);
      if (isNaN(limitPerWorkspace) || limitPerWorkspace < 1 || limitPerWorkspace > 100) {
        throw new BadRequestError('limitPerWorkspace must be an integer between 1 and 100');
      }

      const result = application.listSessionPageGrouped(workspaceIds, { status, rootOnly, limitPerWorkspace });
      return c.json({ sessions: result.sessions, pagination: result.pagination });
    }

    const sessions = application.listSessionsGrouped(workspaceIds, { status, rootOnly });
    return c.json({ sessions });
  });

  app.get('/api/sessions/tags', async (c) => {
    const workspaceId = c.req.query('workspaceId');
    if (!workspaceId) {
      throw new BadRequestError('workspaceId query parameter is required');
    }
    const tags = application.listTagsByWorkspace(workspaceId);
    return c.json({ tags });
  });

  app.get('/api/sessions/:id', async (c) => {
    const id = c.req.param('id');
    const session = application.getSession(id);
    if (!session) {
      throw new NotFoundError('Session not found');
    }
    return c.json({ session });
  });

  app.put(
    '/api/sessions/:id',
    validate('json', updateSessionSchema),
    async (c) => {
      const id = c.req.param('id');
      const body = c.req.valid('json');
      const session = application.updateSession(id, {
        title: body.title,
        status: body.status,
        metadata: body.metadata,
        tags: body.tags,
        autoApproveSeverity: body.autoApproveSeverity,
      });
      if (!session) {
        throw new NotFoundError('Session not found');
      }
      return c.json({ session });
    },
  );

  app.delete('/api/sessions/:id', async (c) => {
    const id = c.req.param('id');
    const deleted = application.deleteSession(id);
    if (!deleted) {
      throw new NotFoundError('Session not found');
    }
    return c.json({ success: true });
  });

  app.get('/api/sessions/:id/messages', async (c) => {
    const sessionId = c.req.param('id');
    const session = application.getSession(sessionId);
    if (!session) {
      throw new NotFoundError('Session not found');
    }
    const messages = application.listMessages(sessionId);
    return c.json({ messages });
  });

  app.get('/api/sessions/:id/transcript', async (c) => {
    const sessionId = c.req.param('id');
    const session = application.getSession(sessionId);
    if (!session) {
      throw new NotFoundError('Session not found');
    }

    const limitParam = c.req.query('limit');
    const beforeParam = c.req.query('before');

    const limit = limitParam ? parseInt(limitParam, 10) : 50;
    if (isNaN(limit) || limit < 1 || limit > 100) {
      throw new BadRequestError('limit must be an integer between 1 and 100');
    }

    if (beforeParam) {
      const beforeSequence = parseInt(beforeParam, 10);
      if (isNaN(beforeSequence) || beforeSequence < 1) {
        throw new BadRequestError('before must be a positive integer');
      }
      const result = await application.transcriptBefore(sessionId, beforeSequence, limit);
      return c.json({
        messages: result.messages,
        pagination: result.pagination,
      });
    }

    const result = await application.latestTranscript(sessionId, limit);
    return c.json({
      messages: result.messages,
      pagination: result.pagination,
    });
  });

  app.get('/api/sessions/:id/tool-parts/:partId/debug', async (c) => {
    const sessionId = c.req.param('id');
    if (!application.getSession(sessionId)) throw new NotFoundError('Session not found');
    const debug = application.getToolDebug(sessionId, c.req.param('partId'));
    if (!debug) throw new NotFoundError('Tool part not found');
    return c.json(debug);
  });

  app.get('/api/sessions/:id/tool-output-artifacts/:artifactId', async (c) => {
    const sessionId = c.req.param('id');
    if (!application.getSession(sessionId)) throw new NotFoundError('Session not found');
    const artifactId = c.req.param('artifactId');
    if (!application.isToolOutputArtifactId(artifactId)) {
      throw new BadRequestError('artifactId must be a UUID');
    }

    const { defaultPageChars, maxPageChars } = application.toolOutputLimits();

    const offsetParam = c.req.query('offset');
    const limitParam = c.req.query('limit');
    if (offsetParam !== undefined && (!/^\d+$/.test(offsetParam) || !Number.isSafeInteger(Number(offsetParam)))) {
      throw new BadRequestError('offset must be a non-negative integer');
    }
    if (limitParam !== undefined && (!/^\d+$/.test(limitParam) || !Number.isSafeInteger(Number(limitParam)))) {
      throw new BadRequestError(`limit must be an integer between 1 and ${maxPageChars}`);
    }
    const offset = offsetParam === undefined ? 0 : Number(offsetParam);
    const limit = limitParam === undefined ? defaultPageChars : Number(limitParam);
    if (limit < 1 || limit > maxPageChars) {
      throw new BadRequestError(`limit must be an integer between 1 and ${maxPageChars}`);
    }

    const page = application.getToolOutputArtifactPage(sessionId, artifactId, offset, limit);
    if (!page) throw new NotFoundError('Tool output artifact not found');
    return c.json(page);
  });

  app.get('/api/sessions/:id/attachments', async (c) => {
    const sessionId = c.req.param('id');
    const session = application.getSession(sessionId);
    if (!session) {
      throw new NotFoundError('Session not found');
    }

    const attachments = application.listAttachments(sessionId);
    return c.json({
      attachments: attachments.map((a) => ({
        id: a.id,
        kind: a.kind,
        filename: a.filename,
        mimeType: a.mimeType,
        size: a.sizeBytes,
        url: `/api/sessions/${sessionId}/attachments/${a.id}/content`,
      })),
    });
  });

  app.post('/api/sessions/:id/attachments', async (c) => {
    const sessionId = c.req.param('id');
    const session = application.getSession(sessionId);
    if (!session) {
      throw new NotFoundError('Session not found');
    }

    const rules = application.attachmentRules();

    const formData = await c.req.formData();
    const file = formData.get('file');
    if (!file || !(file instanceof File)) {
      throw new BadRequestError('No file provided. Use multipart/form-data with field name "file".');
    }

    const mimeType = file.type || 'application/octet-stream';
    const sizeBytes = file.size;

    if (sizeBytes > rules.maxSize) {
      throw new PayloadTooLargeError(`File size (${Math.round(sizeBytes / 1024 / 1024)} MB) exceeds the 20 MB limit.`);
    }

    const kind = rules.determineKind(mimeType);
    if (kind === 'image' && !rules.validateImageMime(mimeType)) {
      throw new BadRequestError(`Image type "${mimeType}" is not supported. Allowed: png, jpeg, webp, gif.`);
    }

    if (sizeBytes === 0) {
      throw new BadRequestError('File is empty.');
    }

    const buffer = await file.arrayBuffer();
    const attachment = application.createAttachment({
      sessionId,
      filename: file.name || 'unnamed',
      mimeType,
      sizeBytes,
      data: buffer,
    });
    if (!attachment) {
      throw new NotFoundError('Session not found');
    }

    return c.json({
      id: attachment.id,
      kind: attachment.kind,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      size: attachment.sizeBytes,
      url: `/api/sessions/${sessionId}/attachments/${attachment.id}/content?key=${attachment.accessKey}`,
    }, 201);
  });

  app.get('/api/sessions/:id/attachments/:attachmentId/content', async (c) => {
    const sessionId = c.req.param('id');
    const attachmentId = c.req.param('attachmentId');
    const accessKey = c.req.query('key');

    if (!accessKey) {
      throw new UnauthorizedError('Missing access key');
    }

    const attachment = application.getAttachmentByKey(attachmentId, accessKey);
    if (!attachment) {
      throw new NotFoundError('Attachment not found');
    }

    if (attachment.sessionId !== sessionId) {
      throw new ForbiddenError('Session mismatch');
    }

    const fileBuffer = application.readAttachmentFile(attachment);
    if (!fileBuffer) {
      throw new NotFoundError('Attachment file not found on disk');
    }

    return new Response(fileBuffer, {
      headers: {
        'Content-Type': attachment.mimeType,
        'Content-Length': String(attachment.sizeBytes),
        'Cache-Control': 'private, max-age=86400',
      },
    });
  });
}
