import { Type, type Static } from '@sinclair/typebox';
import { SuccessEnvelope } from './envelopes.js';

const CheckStatusSchema = Type.Union([Type.Literal('ok'), Type.Literal('down')]);

export const HealthzDataSchema = Type.Object({
  status: Type.Literal('ok'),
  checks: Type.Object({
    db: CheckStatusSchema,
    redis: CheckStatusSchema,
    attachments: CheckStatusSchema,
  }),
  version: Type.String(),
});
export type HealthzData = Static<typeof HealthzDataSchema>;

export const HealthzResponseSchema = SuccessEnvelope(HealthzDataSchema);
export type HealthzResponse = Static<typeof HealthzResponseSchema>;
