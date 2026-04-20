import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import multipart, { type MultipartFile } from '@fastify/multipart';
import {
  ATTACHMENT_MAX_FILE_BYTES,
  ErrorCodes,
  ErrorEnvelopeSchema,
  UploadAttachmentResponseSchema,
} from 'shared-schemas';
import { requireSession } from '../auth/plugin.js';
import { AttachmentError } from './errors.js';
import {
  attachmentRowToPublic,
  authorizeDownload,
  uploadAttachment,
} from './service.js';
import { messageRowToPublic } from '../messages/service.js';
import { sanitizeForContentDisposition } from './sanitize.js';
import { openAttachmentStream } from './storage.js';

const ChatParamsSchema = Type.Object({
  chatId: Type.String({ format: 'uuid' }),
});

const AttachmentParamsSchema = Type.Object({
  attachmentId: Type.String({ format: 'uuid' }),
});

async function readFilePart(part: MultipartFile): Promise<{
  buffer: Buffer;
  truncated: boolean;
}> {
  // Stream the file into memory up to the configured cap. The cap is
  // enforced at the multipart layer (`limits.fileSize` below) so the
  // accumulator can never outrun the limit; when the cap is hit the
  // stream emits `truncated=true` and the service maps it to a 413
  // per AC-ATT-02.
  const chunks: Buffer[] = [];
  for await (const chunk of part.file) {
    chunks.push(chunk as Buffer);
  }
  return {
    buffer: Buffer.concat(chunks),
    truncated: part.file.truncated,
  };
}

export const attachmentsRoutes: FastifyPluginAsyncTypebox = async (fastify) => {
  await fastify.register(multipart, {
    limits: {
      // The transport cap is the larger of the two documented limits
      // so `multipart` doesn't reject oversize images before the
      // service has a chance to map them to `PAYLOAD_TOO_LARGE` with a
      // media-specific limit value. The service re-checks against the
      // image-specific cap post-parse.
      fileSize: ATTACHMENT_MAX_FILE_BYTES,
      files: 1,
      // Bounded header cap (64 KiB) avoids accidental DoS via enormous
      // `commentText` fields while still comfortably fitting any
      // realistic upload comment.
      fieldSize: 64 * 1024,
      fields: 5,
    },
  });

  fastify.post(
    '/chats/:chatId/attachments',
    {
      schema: {
        params: ChatParamsSchema,
        // The body is multipart/form-data, not JSON — Fastify's TypeBox
        // provider doesn't validate the body schema on multipart
        // requests, so we omit `body` here and validate fields inside
        // the handler. Response schema still applies.
        response: {
          200: UploadAttachmentResponseSchema,
          400: ErrorEnvelopeSchema,
          401: ErrorEnvelopeSchema,
          403: ErrorEnvelopeSchema,
          404: ErrorEnvelopeSchema,
          413: ErrorEnvelopeSchema,
        },
      },
    },
    async (req, reply) => {
      const session = requireSession(req);
      if (!req.isMultipart()) {
        throw new AttachmentError(
          ErrorCodes.VALIDATION_ERROR,
          400,
          'Attachment uploads must use multipart/form-data.',
        );
      }

      let fileBuffer: Buffer | undefined;
      let originalFilename: string | undefined;
      let mimeType: string | null = null;
      let truncated = false;
      let commentText: string | null = null;

      // Iterate parts ourselves rather than relying on
      // `req.file()` — we need to accept the optional `commentText`
      // field alongside the single `file` part, and `req.saveRequestFiles()`
      // would otherwise buffer the whole upload to `/tmp`.
      for await (const part of req.parts()) {
        if (part.type === 'file') {
          if (fileBuffer !== undefined) {
            throw new AttachmentError(
              ErrorCodes.VALIDATION_ERROR,
              400,
              'Only a single file part is allowed.',
              { field: 'file' },
            );
          }
          if (part.fieldname !== 'file') {
            throw new AttachmentError(
              ErrorCodes.VALIDATION_ERROR,
              400,
              'File part must be named "file".',
              { field: part.fieldname },
            );
          }
          const read = await readFilePart(part);
          fileBuffer = read.buffer;
          truncated = read.truncated;
          originalFilename = part.filename;
          mimeType = part.mimetype;
        } else if (part.fieldname === 'commentText') {
          const value = typeof part.value === 'string' ? part.value : '';
          commentText = value.length > 0 ? value : null;
        }
      }

      if (fileBuffer === undefined || originalFilename === undefined) {
        throw new AttachmentError(
          ErrorCodes.VALIDATION_ERROR,
          400,
          'Attachment upload requires a "file" part.',
          { field: 'file' },
        );
      }

      const result = await uploadAttachment({
        chatId: req.params.chatId,
        uploaderUserId: session.user.id,
        originalFilename,
        mimeType,
        buffer: fileBuffer,
        commentText,
        truncated,
      });

      return reply.status(200).send({
        data: {
          attachment: attachmentRowToPublic(result.attachment),
          message: messageRowToPublic(result.message),
        },
      });
    },
  );

  fastify.get(
    '/attachments/:attachmentId/download',
    {
      // No response-schema entry: successful downloads return a binary
      // stream, not JSON, and TypeBox would otherwise run the
      // response body through its serializer. Error responses still
      // flow through the global error handler in `server.ts`.
      schema: { params: AttachmentParamsSchema },
    },
    async (req, reply) => {
      const session = requireSession(req);
      const { row } = await authorizeDownload({
        attachmentId: req.params.attachmentId,
        callerUserId: session.user.id,
      });
      const { stream, sizeBytes } = await openAttachmentStream(row.storagePath);
      const disposition = sanitizeForContentDisposition(row.originalFilename);
      // RFC 6266 §4.3: emit both a legacy ASCII `filename` and the
      // RFC 5987 `filename*` form. Modern clients use the UTF-8 form;
      // older ones fall back to the ASCII-safe name. The `filename*`
      // value is the original filename in its entirety; the
      // `asciiFallback` strips unsafe characters so it can't
      // smuggle header bytes.
      void reply
        .header(
          'Content-Disposition',
          `attachment; filename="${disposition.asciiFallback}"; filename*=UTF-8''${disposition.rfc5987}`,
        )
        .header('Content-Length', sizeBytes.toString())
        .header('Content-Type', row.mimeType ?? 'application/octet-stream')
        // Keep the downloader cache-neutral: every download re-evaluates
        // auth against current membership (AC-ATT-03), so a cached copy
        // stuck in an intermediary after the user lost access would
        // defeat the check.
        .header('Cache-Control', 'private, no-store')
        .header('X-Content-Type-Options', 'nosniff');
      return reply.send(stream);
    },
  );
};
