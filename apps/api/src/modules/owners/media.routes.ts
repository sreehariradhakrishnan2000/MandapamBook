import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { and, count, eq, ne } from 'drizzle-orm';
import { fileTypeFromBuffer } from 'file-type';
import { MEDIA_MAX_PER_VENUE, mediaUpdateSchema, mediaUploadSchema } from '@mandapambook/shared';
import type { Db } from '../../db/client.js';
import { media } from '../../db/schema/index.js';
import { HttpError, errors } from '../../http/errors.js';
import type { ObjectStorage } from '../../infra/storage.js';
import { type AuditService, auditContext } from '../audit/audit.service.js';
import { currentUser, requirePermission } from '../rbac/authenticate.js';
import { type ScopedResources, requireOwner } from './scoped.js';

const UPLOAD_URL_TTL = 10 * 60;
const SNIFF_BYTES = 4100;
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function mediaRouter(deps: {
  db: Db;
  scoped: ScopedResources;
  storage: ObjectStorage;
  audit: AuditService;
}): Router {
  const { db, scoped, storage, audit } = deps;
  const r = Router();

  /**
   * Step 1: reserve a photo slot and get a presigned PUT. The URL only accepts the declared
   * content type and exact byte size, and the object key is chosen by the server.
   */
  r.post(
    '/auditoriums/:id/media/upload-url',
    requirePermission('auditorium:update'),
    async (req, res) => {
      const me = currentUser(req);
      const scope = await scoped.scope(req);
      requireOwner(scope);
      const venue = await scoped.auditorium(scope, req.params['id']);
      const input = mediaUploadSchema.parse(req.body);

      const [{ n } = { n: 0 }] = await db
        .select({ n: count() })
        .from(media)
        .where(and(eq(media.auditoriumId, venue.id), ne(media.status, 'REJECTED')));
      if (n >= MEDIA_MAX_PER_VENUE) {
        throw errors.conflict(
          'TOO_MANY_PHOTOS',
          `A venue can have up to ${MEDIA_MAX_PER_VENUE} photos`,
        );
      }

      const storageKey = `venues/${venue.id}/${randomUUID()}.${EXTENSIONS[input.mimeType]}`;
      const [row] = await db
        .insert(media)
        .values({
          auditoriumId: venue.id,
          storageKey,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          altText: input.altText,
          sortOrder: n,
          status: 'PENDING_UPLOAD',
          uploadedBy: me.userId,
        })
        .returning();
      if (!row) throw new Error('media insert failed');
      const upload = await storage.createUploadUrl(
        storageKey,
        input.mimeType,
        input.sizeBytes,
        UPLOAD_URL_TTL,
      );
      res.status(201).json({ mediaId: row.id, upload });
    },
  );

  /**
   * Step 2: after the browser uploads, verify what actually arrived: it must exist, match
   * the declared size, and its bytes must really be the declared image type (not a renamed
   * HTML/SVG/executable). Anything else is deleted from storage and marked rejected.
   */
  r.post('/media/:mediaId/confirm', requirePermission('auditorium:update'), async (req, res) => {
    const me = currentUser(req);
    const scope = await scoped.scope(req);
    requireOwner(scope);
    const row = await scoped.media(scope, req.params['mediaId']);
    if (row.status === 'READY') {
      res.json({ id: row.id, status: row.status });
      return;
    }
    if (row.status === 'REJECTED')
      throw errors.conflict('MEDIA_REJECTED', 'This upload was rejected. Upload the photo again.');

    const info = await storage.head(row.storageKey);
    if (!info)
      throw errors.conflict(
        'UPLOAD_MISSING',
        'We have not received the file yet. Upload it, then try again.',
      );

    const reject = async (reason: string, message: string): Promise<never> => {
      await storage.delete(row.storageKey).catch(() => undefined);
      await db.update(media).set({ status: 'REJECTED' }).where(eq(media.id, row.id));
      await audit.record(
        {
          action: 'media.rejected',
          entityType: 'media',
          entityId: row.id,
          actorId: me.userId,
          actorRole: me.role,
          after: { reason, declared: row.mimeType, sizeBytes: info.sizeBytes },
        },
        auditContext(req),
      );
      throw new HttpError(422, 'INVALID_IMAGE', message);
    };

    if (info.sizeBytes !== row.sizeBytes) {
      await reject('size_mismatch', 'The uploaded file is not the size that was declared.');
    }
    const detected = await fileTypeFromBuffer(
      await storage.readPrefix(row.storageKey, SNIFF_BYTES),
    );
    if (!detected || detected.mime !== row.mimeType) {
      await reject('type_mismatch', 'The file is not a valid JPEG, PNG or WebP image.');
    }

    const [ready] = await db
      .update(media)
      .set({ status: 'READY' })
      .where(eq(media.id, row.id))
      .returning();
    res.json({ id: ready?.id, status: ready?.status });
  });

  r.patch('/media/:mediaId', requirePermission('auditorium:update'), async (req, res) => {
    const scope = await scoped.scope(req);
    requireOwner(scope);
    const row = await scoped.media(scope, req.params['mediaId']);
    const input = mediaUpdateSchema.parse(req.body);
    const [updated] = await db.update(media).set(input).where(eq(media.id, row.id)).returning();
    res.json({ id: updated?.id, altText: updated?.altText, sortOrder: updated?.sortOrder });
  });

  r.delete('/media/:mediaId', requirePermission('auditorium:update'), async (req, res) => {
    const scope = await scoped.scope(req);
    requireOwner(scope);
    const row = await scoped.media(scope, req.params['mediaId']);
    await db.delete(media).where(eq(media.id, row.id));
    await storage.delete(row.storageKey).catch(() => undefined);
    res.status(204).end();
  });

  return r;
}
