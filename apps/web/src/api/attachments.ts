import type { UploadAttachmentResponse } from 'shared-schemas';
import { ApiError, apiBaseUrl, getCsrfHeader } from './client.js';

type UploadAttachmentData = UploadAttachmentResponse['data'];

export interface UploadAttachmentInput {
  chatId: string;
  file: File;
  commentText?: string | null;
}

// Multipart upload — bypasses `apiRequest` because that helper
// JSON-stringifies the body. FormData must travel raw so the browser
// sets the `multipart/form-data; boundary=…` header automatically.
export async function uploadAttachment({
  chatId,
  file,
  commentText,
}: UploadAttachmentInput): Promise<UploadAttachmentData> {
  const form = new FormData();
  form.append('file', file, file.name);
  if (commentText !== undefined && commentText !== null && commentText.length > 0) {
    form.append('commentText', commentText);
  }
  const response = await fetch(`${apiBaseUrl}/chats/${chatId}/attachments`, {
    method: 'POST',
    credentials: 'include',
    headers: getCsrfHeader(),
    body: form,
  });
  const text = await response.text();
  let parsed: unknown = null;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch (err) {
      throw new ApiError(response.status, {
        error: {
          code: 'UNKNOWN',
          message: `Response was not valid JSON (${
            err instanceof Error ? err.message : 'parse error'
          })`,
        },
      });
    }
  }
  if (!response.ok) {
    if (isErrorEnvelope(parsed)) {
      throw new ApiError(response.status, parsed);
    }
    throw new ApiError(response.status, {
      error: {
        code: 'UNKNOWN',
        message: `Upload failed with status ${response.status.toString()}`,
      },
    });
  }
  if (!isSuccessEnvelope(parsed)) {
    throw new ApiError(response.status, {
      error: {
        code: 'UNKNOWN',
        message: 'Upload response did not match the success-envelope shape',
      },
    });
  }
  return parsed.data as UploadAttachmentData;
}

// The download endpoint returns a binary stream with `Content-Disposition:
// attachment`, so an anchor `<a href download>` is the simplest path: the
// browser handles save-as, cookies travel via same-origin (Vite proxy in
// dev, same-origin in prod), and no client code needs to buffer the body.
export function attachmentDownloadUrl(attachmentId: string): string {
  return `${apiBaseUrl}/attachments/${attachmentId}/download`;
}

function isErrorEnvelope(
  value: unknown,
): value is { error: { code: string; message: string } } {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { error?: unknown };
  if (typeof candidate.error !== 'object' || candidate.error === null) return false;
  const err = candidate.error as { code?: unknown; message?: unknown };
  return typeof err.code === 'string' && typeof err.message === 'string';
}

function isSuccessEnvelope(value: unknown): value is { data: unknown } {
  if (typeof value !== 'object' || value === null) return false;
  return 'data' in value;
}
