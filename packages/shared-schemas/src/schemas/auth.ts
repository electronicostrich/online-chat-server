import { Type, type Static } from '@sinclair/typebox';
import { SuccessEnvelope } from './envelopes.js';
import {
  EMAIL_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
} from '../constants/limits.js';

// Keep patterns permissive at the schema layer; business-rule validation
// (e.g. password complexity 3-of-4 character classes) lives in the service.
const EmailSchema = Type.String({
  format: 'email',
  maxLength: EMAIL_MAX_LENGTH,
  minLength: 3,
});

const UsernameSchema = Type.String({
  minLength: USERNAME_MIN_LENGTH,
  maxLength: USERNAME_MAX_LENGTH,
  pattern: '^[a-zA-Z0-9._-]+$',
});

const PasswordSchema = Type.String({
  minLength: PASSWORD_MIN_LENGTH,
  maxLength: PASSWORD_MAX_LENGTH,
});

export const RegisterRequestSchema = Type.Object(
  {
    email: EmailSchema,
    username: UsernameSchema,
    password: PasswordSchema,
  },
  { additionalProperties: false },
);
export type RegisterRequest = Static<typeof RegisterRequestSchema>;

const UserPublicSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  email: Type.String(),
  username: Type.String(),
});

const SessionPublicSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  createdAt: Type.String({ format: 'date-time' }),
});

export const AuthSessionResponseDataSchema = Type.Object({
  user: UserPublicSchema,
  session: SessionPublicSchema,
});

export const AuthSessionResponseSchema = SuccessEnvelope(AuthSessionResponseDataSchema);
export type AuthSessionResponse = Static<typeof AuthSessionResponseSchema>;

export const LoginRequestSchema = Type.Object(
  {
    email: EmailSchema,
    password: PasswordSchema,
  },
  { additionalProperties: false },
);
export type LoginRequest = Static<typeof LoginRequestSchema>;

const OkResponseDataSchema = Type.Object({ ok: Type.Literal(true) });
export const OkResponseSchema = SuccessEnvelope(OkResponseDataSchema);
export type OkResponse = Static<typeof OkResponseSchema>;

const SessionListItemSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  current: Type.Boolean(),
  userAgent: Type.Union([Type.String(), Type.Null()]),
  ipAddress: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String({ format: 'date-time' }),
  lastSeenAt: Type.String({ format: 'date-time' }),
});

export const SessionsListResponseDataSchema = Type.Object({
  sessions: Type.Array(SessionListItemSchema),
});
export const SessionsListResponseSchema = SuccessEnvelope(
  SessionsListResponseDataSchema,
);
export type SessionsListResponse = Static<typeof SessionsListResponseSchema>;

export const LogoutSessionRequestSchema = Type.Object(
  {
    sessionId: Type.String({ format: 'uuid' }),
  },
  { additionalProperties: false },
);
export type LogoutSessionRequest = Static<typeof LogoutSessionRequestSchema>;

export const PasswordChangeRequestSchema = Type.Object(
  {
    currentPassword: PasswordSchema,
    newPassword: PasswordSchema,
  },
  { additionalProperties: false },
);
export type PasswordChangeRequest = Static<typeof PasswordChangeRequestSchema>;

export const PasswordResetRequestSchema = Type.Object(
  {
    email: EmailSchema,
  },
  { additionalProperties: false },
);
export type PasswordResetRequest = Static<typeof PasswordResetRequestSchema>;

export const PasswordResetConfirmSchema = Type.Object(
  {
    token: Type.String({ minLength: 8, maxLength: 128 }),
    newPassword: PasswordSchema,
  },
  { additionalProperties: false },
);
export type PasswordResetConfirm = Static<typeof PasswordResetConfirmSchema>;
