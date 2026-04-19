// Per data-model.md §4.1: username normalization = trim + NFC +
// internal-whitespace-collapse + case-insensitive. Email follows the same
// shape (trim + lowercase) since SMTP local parts are case-insensitive on
// virtually every real mail host.

export function normalizeUsername(raw: string): string {
  return raw
    .normalize('NFC')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLowerCase();
}

export function normalizeEmail(raw: string): string {
  // NFC so visually-identical Unicode sequences collide in the unique index.
  return raw.normalize('NFC').trim().toLowerCase();
}
