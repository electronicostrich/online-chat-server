import { createReadStream, type ReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { config } from '../../config/env.js';

// All attachment binaries live under a single root directory. Each chat
// gets its own subdirectory so a chat-scoped cleanup (future 30-day
// hard-purge, WS-08) is a single `rm -rf <chatRoot>/<chatId>` call.
//
// The storage-path layout is an implementation detail of this module;
// callers only ever see the `attachmentId` that went into the DB row.
// `storagePathFor` is exported so the repository can persist the exact
// path it wrote, which makes a future migration to a different backend
// (e.g., S3) straightforward — each row carries its own path.

function rootDir(): string {
  return resolve(config.ATTACHMENT_ROOT_DIR);
}

function chatDir(chatId: string): string {
  return join(rootDir(), chatId);
}

// Throws if `path` resolves outside `ATTACHMENT_ROOT_DIR`. All
// read/write/delete callers route through this helper so a malformed
// chatId / attachmentId (or a DB row whose `storage_path` was
// tampered with) cannot escape the attachment root.
function assertWithinRoot(path: string): string {
  const absolute = resolve(path);
  const root = rootDir();
  const rel = relative(root, absolute);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) {
    throw new Error('Attachment path escapes ATTACHMENT_ROOT_DIR.');
  }
  return absolute;
}

export function storagePathFor(chatId: string, attachmentId: string): string {
  return assertWithinRoot(join(chatDir(chatId), attachmentId));
}

// Persists the buffer to disk under `<root>/<chatId>/<attachmentId>`.
// Uses `writeFile` (not a stream pipe) because the upload is already
// fully buffered by the multipart handler — we need the exact byte
// length anyway for the DB row and the size-limit check.
export async function writeAttachmentBinary(params: {
  chatId: string;
  attachmentId: string;
  buffer: Buffer;
}): Promise<string> {
  const target = storagePathFor(params.chatId, params.attachmentId);
  await mkdir(chatDir(params.chatId), { recursive: true });
  await writeFile(target, params.buffer);
  return target;
}

export async function removeAttachmentBinary(path: string): Promise<void> {
  await rm(assertWithinRoot(path), { force: true });
}

// Opens a read stream for the stored file. Callers must verify the
// metadata row first; the stream itself doesn't re-check authorization.
export async function openAttachmentStream(path: string): Promise<{
  stream: ReadStream;
  sizeBytes: number;
}> {
  const safe = assertWithinRoot(path);
  const stats = await stat(safe);
  return { stream: createReadStream(safe), sizeBytes: stats.size };
}
