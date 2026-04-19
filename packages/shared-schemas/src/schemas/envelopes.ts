import { Type, type TSchema, type Static } from '@sinclair/typebox';

export const SuccessEnvelope = <T extends TSchema>(inner: T) => Type.Object({ data: inner });

export const PaginationSchema = Type.Object({
  nextCursor: Type.Union([Type.Integer(), Type.String(), Type.Null()]),
  hasMore: Type.Boolean(),
  limit: Type.Integer(),
});
export type Pagination = Static<typeof PaginationSchema>;

export const PaginatedEnvelope = <T extends TSchema>(inner: T) =>
  Type.Object({ data: Type.Array(inner), pagination: PaginationSchema });

export const ErrorEnvelopeSchema = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    traceId: Type.String(),
  }),
});
export type ErrorEnvelope = Static<typeof ErrorEnvelopeSchema>;
