import { Redis } from 'ioredis';
import { config } from '../config/env.js';
import { logger } from '../logger.js';

export const redis = new Redis(config.REDIS_URL, { lazyConnect: false });

// ioredis emits 'error' on connection/socket failures; unhandled listeners
// would crash the process. Log via Pino so the healthz 'redis' check can
// still surface the state without taking the whole server down.
redis.on('error', (err: Error) => {
  logger.error({ err }, 'redis connection error');
});
