// Per data-model.md §4.8: room names use the same normalization rule as
// usernames (trim + NFC + whitespace-collapse + lowercase). The human-
// readable `name` is stored as entered; `normalized_name` is the unique
// key. Exposed here rather than reusing `normalizeUsername` so future
// rules (e.g. stricter allow-list for rooms) don't quietly affect auth.

export function normalizeRoomName(raw: string): string {
  return raw.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();
}
