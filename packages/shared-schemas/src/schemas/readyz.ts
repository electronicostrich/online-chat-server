import { Type, type Static } from '@sinclair/typebox';
import { SuccessEnvelope } from './envelopes.js';

const CheckStatusSchema = Type.Union([Type.Literal('ok'), Type.Literal('down')]);

export const ReadyzDataSchema = Type.Object({
  status: Type.Literal('ready'),
  checks: Type.Object({
    db: CheckStatusSchema,
    redis: CheckStatusSchema,
    attachments: CheckStatusSchema,
    migrations: CheckStatusSchema,
  }),
  version: Type.String(),
});
export type ReadyzData = Static<typeof ReadyzDataSchema>;

export const ReadyzResponseSchema = SuccessEnvelope(ReadyzDataSchema);
export type ReadyzResponse = Static<typeof ReadyzResponseSchema>;
