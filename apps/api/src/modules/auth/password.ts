import { hash, verify } from '@node-rs/argon2';
import { config } from '../../config/env.js';

// Algorithm.Argon2id === 2 per @node-rs/argon2 index.d.ts. We inline the
// numeric constant because the enum is a `const enum`, which conflicts with
// verbatimModuleSyntax. Argon2id is the algorithm mandated by data-model.md
// §4.1 / runtime-and-environment.md §6.1.
const ARGON2ID = 2;
const hashOptions = {
  algorithm: ARGON2ID,
  memoryCost: config.PASSWORD_ARGON2_MEMORY_KIB,
  timeCost: config.PASSWORD_ARGON2_ITERATIONS,
  parallelism: config.PASSWORD_ARGON2_PARALLELISM,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, hashOptions);
}

export function verifyPassword(hashValue: string, plain: string): Promise<boolean> {
  return verify(hashValue, plain);
}

// Product rules require min length + at least 3 of 4 character classes.
// Length is enforced at the schema layer; this check handles complexity.
export function passwordMeetsComplexity(plain: string): boolean {
  const classes = [
    /[a-z]/.test(plain),
    /[A-Z]/.test(plain),
    /[0-9]/.test(plain),
    /[^a-zA-Z0-9]/.test(plain),
  ].filter(Boolean).length;
  return classes >= 3;
}
