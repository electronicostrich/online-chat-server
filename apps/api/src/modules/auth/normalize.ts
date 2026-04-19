// Per data-model.md §4.1: username normalization = trim + NFC +
// internal-whitespace-collapse + case-insensitive. Email follows the same
// shape (NFC + trim + lowercase). Treating the local part as
// case-insensitive is an application-level policy — RFC 5321 technically
// leaves local-part case sensitivity to the receiving server, and a small
// number of hosts do honour it. We accept that trade-off because forcing
// users to remember case in their own email would be worse UX than the
// theoretical collision.

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
