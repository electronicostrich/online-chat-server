import pino, { type LoggerOptions } from 'pino';
import { config } from './config/env.js';

const options: LoggerOptions = { level: config.LOG_LEVEL };
if (config.NODE_ENV === 'development') {
  options.transport = { target: 'pino-pretty' };
}

export const logger = pino(options);
