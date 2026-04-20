// AC-ATTACH-06: original filename is preserved in metadata but the value
// is never trusted for filesystem paths or download headers. These
// helpers produce safe representations for the two consumer surfaces:
//
// - `sanitizeForContentDisposition` returns a pair (asciiFallback,
//   rfc5987) so the response can set both the legacy
//   `filename="..."` parameter and the modern `filename*=UTF-8''...`
//   parameter per RFC 6266 §4.3.
// - `sanitizeStoredOriginalName` clamps the stored metadata to a sane
//   length and strips NUL / control chars that would confuse downstream
//   rendering. The *storage path* itself never uses this value — it
//   uses the attachment's UUID — so we only sanitize what goes into
//   the DB / JSON body, not the on-disk name.

const STORED_MAX_LENGTH = 255;

export function sanitizeStoredOriginalName(raw: string): string {
  // Strip NUL and other C0/C1 control characters (\u0000-\u001F,
  // \u007F-\u009F); they have no legitimate place in a filename and
  // some of them (NUL, CR, LF) would truncate or inject when piped
  // into shell arguments or log lines.
  const cleaned = raw.replace(/[\u0000-\u001F\u007F-\u009F]/gu, '');
  const trimmed = cleaned.trim();
  if (trimmed.length === 0) return 'file';
  if (trimmed.length > STORED_MAX_LENGTH) {
    return trimmed.slice(0, STORED_MAX_LENGTH);
  }
  return trimmed;
}

export interface SanitizedDispositionName {
  asciiFallback: string;
  rfc5987: string;
}

const UNSAFE_ASCII = /[^A-Za-z0-9._-]/gu;

export function sanitizeForContentDisposition(raw: string): SanitizedDispositionName {
  // ASCII fallback: collapse anything outside a conservative allowlist
  // to `_`. The fallback is only displayed by ancient clients that
  // ignore `filename*`; modern ones use the RFC 5987 form below and see
  // the real name. We intentionally also collapse `/` and `\` so that
  // a malicious filename can't smuggle a different header value or
  // a fake extension into the fallback.
  const ascii = raw.replace(UNSAFE_ASCII, '_');
  const trimmedAscii = ascii.replace(/^_+|_+$/gu, '');
  const asciiFallback = trimmedAscii.length === 0 ? 'file' : trimmedAscii;

  // RFC 5987 allows UTF-8 via `filename*=UTF-8''<percent-encoded>`. The
  // encoding must percent-encode every byte that isn't in the
  // "attr-char" set (unreserved per RFC 3986 plus `!#$&+-.^_`~|`).
  const rfc5987 = encodeRfc5987(raw);
  return { asciiFallback, rfc5987 };
}

const ATTR_CHAR = /[A-Za-z0-9!#$&+\-.^_`|~]/u;

function encodeRfc5987(value: string): string {
  const utf8 = new TextEncoder().encode(value);
  let out = '';
  for (const byte of utf8) {
    const ch = String.fromCharCode(byte);
    if (ATTR_CHAR.test(ch)) {
      out += ch;
    } else {
      out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    }
  }
  return out;
}
