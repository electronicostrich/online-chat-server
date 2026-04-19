import pino, { type LoggerOptions } from 'pino';
import { config } from './config/env.js';

// Single source of truth for Pino configuration. Both the standalone
// migrate/index entry-points and the Fastify server (via server.ts) must use
// this same option set so logger behaviour can't drift between contexts.
export const loggerOptions: LoggerOptions = { level: config.LOG_LEVEL };
if (config.NODE_ENV === 'development') {
  loggerOptions.transport = { target: 'pino-pretty' };
}

export const logger = pino(loggerOptions);
