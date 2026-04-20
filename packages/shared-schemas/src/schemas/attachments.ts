import { Type, type Static } from '@sinclair/typebox';
import { SuccessEnvelope } from './envelopes.js';
import { MessagePublicSchema } from './messages.js';

export const AttachmentPublicSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  chatId: Type.String({ format: 'uuid' }),
  messageId: Type.String({ format: 'uuid' }),
  originalFilename: Type.String(),
  sizeBytes: Type.Integer({ minimum: 0 }),
  mimeType: Type.Union([Type.String(), Type.Null()]),
  commentText: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String({ format: 'date-time' }),
});
export type AttachmentPublic = Static<typeof AttachmentPublicSchema>;

// AC-ATT-01 upload response: the shared-schemas shape wraps both the
// attachment metadata and the sibling `kind='attachment'` message that
// WS-04/WS-05 require so clients can render the upload in the same
// timeline as text messages.
export const UploadAttachmentResponseSchema = SuccessEnvelope(
  Type.Object({
    attachment: AttachmentPublicSchema,
    message: MessagePublicSchema,
  }),
);
export type UploadAttachmentResponse = Static<typeof UploadAttachmentResponseSchema>;
