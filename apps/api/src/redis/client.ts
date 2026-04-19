import { Redis } from 'ioredis';
import { config } from '../config/env.js';

export const redis = new Redis(config.REDIS_URL, { lazyConnect: false });
