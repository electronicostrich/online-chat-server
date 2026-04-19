export const ErrorCodes = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  NOT_FOUND: 'NOT_FOUND',
} as const;
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
