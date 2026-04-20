import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import type { AttachmentPublic, MessagePublic } from 'shared-schemas';
import { attachmentDownloadUrl } from '../api/attachments.js';

// AC-UI-02 / AC-UI-03 — autoscroll behaviour:
//   - if the user is at (or within `BOTTOM_THRESHOLD` of) the bottom when a
//     new message lands, the scroll position follows so the new message is
//     visible (AC-UI-02);
//   - if the user has scrolled up to read older history, the view is *not*
//     forcibly jumped to the bottom; instead a "↓ N new" pill is shown so
//     they can opt-in (AC-UI-03).
//
// Tracking the "is the user at bottom" bit imperatively (via scroll listener
// + ref) avoids triggering a re-render on every wheel tick.
const BOTTOM_THRESHOLD = 32;

interface MessageListProps {
  messages: MessagePublic[];
  currentUserId: string | null;
  onEdit: (messageId: string, bodyText: string) => Promise<void>;
  // Called whenever the user is "caught up" — either they just scrolled
  // back to the bottom, or they dismissed the unread pill. The argument is
  // the sequence of the newest message on screen; the caller is expected
  // to advance the server-side read watermark up to that value.
  onCatchUp?: (sequence: number) => void;
  // AC-ATT-01 UI — attachment metadata keyed by `messageId`. Only messages
  // with `kind='attachment'` are expected to appear in this map; missing
  // entries fall back to a generic placeholder since the list-messages
  // response does not currently embed attachment rows.
  attachmentsByMessageId?: Record<string, AttachmentPublic>;
}

export function MessageList({
  messages,
  currentUserId,
  onEdit,
  onCatchUp,
  attachmentsByMessageId,
}: MessageListProps): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Mutable so the layout effect can read the latest user-position bit
  // without re-subscribing on every render.
  const isAtBottomRef = useRef(true);
  const lastSeenSequenceRef = useRef<number>(0);
  const [unreadBelow, setUnreadBelow] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);

  function isAtBottomNow(el: HTMLDivElement): boolean {
    const distance = el.scrollHeight - el.clientHeight - el.scrollTop;
    return distance <= BOTTOM_THRESHOLD;
  }

  useEffect(() => {
    const el = containerRef.current;
    if (el === null) return;
    function handleScroll(): void {
      if (el === null) return;
      const atBottom = isAtBottomNow(el);
      const wasAtBottom = isAtBottomRef.current;
      isAtBottomRef.current = atBottom;
      // Mirror the at-bottom flag onto a DOM attribute so Playwright specs
      // can `await expect(...).toHaveAttribute('data-at-bottom', 'false')`
      // instead of sleeping after a programmatic scroll.
      el.setAttribute('data-at-bottom', atBottom ? 'true' : 'false');
      if (atBottom) {
        setUnreadBelow(0);
        if (messages.length > 0) {
          const last = messages[messages.length - 1];
          if (last !== undefined) {
            lastSeenSequenceRef.current = last.sequence;
            // Fire catch-up only on the transition false → true so a user
            // who idles at the bottom doesn't trigger advance calls on
            // every wheel-tick.
            if (!wasAtBottom) onCatchUp?.(last.sequence);
          }
        }
      }
    }
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', handleScroll);
    };
    // `messages` is referenced inside the callback for the side effect of
    // updating `lastSeenSequenceRef`; re-subscribing on every change keeps
    // that lookup pointing at the latest array.
  }, [messages, onCatchUp]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (el === null) return;
    if (messages.length === 0) {
      lastSeenSequenceRef.current = 0;
      setUnreadBelow(0);
      return;
    }
    const newest = messages[messages.length - 1];
    if (newest === undefined) return;
    if (isAtBottomRef.current) {
      // AC-UI-02: stick to bottom when the user is already there.
      el.scrollTop = el.scrollHeight;
      lastSeenSequenceRef.current = newest.sequence;
      setUnreadBelow(0);
      return;
    }
    // AC-UI-03: do not scroll. Surface an unread count instead so the user
    // can opt into jumping to bottom.
    const last = lastSeenSequenceRef.current;
    const newer = messages.filter((m) => m.sequence > last).length;
    if (newer > 0) setUnreadBelow(newer);
  }, [messages]);

  function jumpToBottom(): void {
    const el = containerRef.current;
    if (el === null) return;
    el.scrollTop = el.scrollHeight;
    isAtBottomRef.current = true;
    setUnreadBelow(0);
    if (messages.length > 0) {
      const last = messages[messages.length - 1];
      if (last !== undefined) {
        lastSeenSequenceRef.current = last.sequence;
        // Clicking the unread pill is an explicit "I've caught up" — fire
        // catch-up so the server-side watermark advances past the rows the
        // user just jumped over.
        onCatchUp?.(last.sequence);
      }
    }
  }

  return (
    <div className="message-list-wrapper" data-testid="message-list-wrapper">
      <div
        className="message-list"
        ref={containerRef}
        data-testid="message-list"
        data-at-bottom="true"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        {messages.length === 0 ? (
          <p className="empty-state" data-testid="message-list-empty">
            No messages yet. Send the first one below.
          </p>
        ) : (
          messages.map((message) => (
            <MessageRow
              key={message.id}
              message={message}
              attachment={attachmentsByMessageId?.[message.id] ?? null}
              isOwn={
                currentUserId !== null && message.authorUserId === currentUserId
              }
              isEditing={editingId === message.id}
              onStartEdit={() => {
                setEditingId(message.id);
              }}
              onCancelEdit={() => {
                setEditingId(null);
              }}
              onSaveEdit={async (nextBody) => {
                await onEdit(message.id, nextBody);
                setEditingId(null);
              }}
            />
          ))
        )}
      </div>
      {unreadBelow > 0 ? (
        <button
          type="button"
          className="unread-pill"
          data-testid="unread-pill"
          onClick={jumpToBottom}
        >
          ↓ {unreadBelow.toString()} new
        </button>
      ) : null}
    </div>
  );
}

interface MessageRowProps {
  message: MessagePublic;
  attachment: AttachmentPublic | null;
  isOwn: boolean;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (bodyText: string) => Promise<void>;
}

function MessageRow({
  message,
  attachment,
  isOwn,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
}: MessageRowProps): ReactElement {
  const isDeleted = message.deletedAt !== null;
  const isAttachment = message.kind === 'attachment';
  // Attachment rows are not edited through the existing text-edit flow —
  // the contract only supports editing text bodies, and the UI doesn't
  // offer a way to swap the binary. Treat attachment rows as read-only
  // even for the author.
  const canEdit = isOwn && !isDeleted && !isAttachment;

  return (
    <article
      className={`message${isDeleted ? ' message-deleted' : ''}${isAttachment ? ' message-attachment' : ''}`}
      data-testid="message"
      data-sequence={message.sequence.toString()}
      data-message-id={message.id}
      data-kind={message.kind}
    >
      <div className="message-meta">
        <span className="message-author">{message.authorUserId.slice(0, 8)}</span>
        <time dateTime={message.createdAt}>
          {new Date(message.createdAt).toLocaleTimeString()}
        </time>
        {message.editedAt !== null && !isDeleted ? (
          <span
            className="message-edited"
            data-testid="message-edited"
            title={`Edited at ${message.editedAt}`}
          >
            (edited)
          </span>
        ) : null}
      </div>
      {isEditing && !isDeleted ? (
        <MessageEditor
          initialBody={message.bodyText ?? ''}
          onCancel={onCancelEdit}
          onSave={onSaveEdit}
        />
      ) : (
        <>
          {isAttachment && !isDeleted ? (
            <AttachmentSurface attachment={attachment} commentFallback={message.bodyText} />
          ) : (
            <div className="message-body" data-testid="message-body">
              {isDeleted ? '(deleted)' : (message.bodyText ?? '')}
            </div>
          )}
          {canEdit ? (
            <div className="message-actions">
              <button
                type="button"
                className="message-action"
                data-testid="message-edit"
                onClick={onStartEdit}
              >
                Edit
              </button>
            </div>
          ) : null}
        </>
      )}
    </article>
  );
}

interface AttachmentSurfaceProps {
  attachment: AttachmentPublic | null;
  commentFallback: string | null;
}

function AttachmentSurface({
  attachment,
  commentFallback,
}: AttachmentSurfaceProps): ReactElement {
  if (attachment === null) {
    // History fallback: when the user reloads the page, the current
    // `GET /chats/{id}/messages` contract doesn't carry attachment rows,
    // so the UI has no filename or size to show. Surface the sibling
    // comment (the message's `bodyText`) if present so the thread still
    // reads coherently.
    return (
      <div className="message-body" data-testid="message-body">
        <span
          className="attachment-placeholder"
          data-testid="attachment-placeholder"
        >
          [Attachment]
        </span>
        {commentFallback !== null && commentFallback.length > 0 ? (
          <span className="attachment-comment"> — {commentFallback}</span>
        ) : null}
      </div>
    );
  }
  const sizeLabel = formatBytes(attachment.sizeBytes);
  return (
    <div className="message-body" data-testid="message-body">
      <div
        className="attachment-card"
        data-testid="attachment-card"
        data-attachment-id={attachment.id}
      >
        <a
          className="attachment-download"
          data-testid="attachment-download"
          href={attachmentDownloadUrl(attachment.id)}
          // `download` hints the browser to save instead of navigate;
          // the server still drives the filename via Content-Disposition
          // (AC-ATTACH-06) so the anchor value is only a fallback for
          // clients that ignore the header.
          download={attachment.originalFilename}
          rel="noopener"
        >
          <span className="attachment-filename" data-testid="attachment-filename">
            {attachment.originalFilename}
          </span>
          <span className="attachment-size" data-testid="attachment-size">
            {sizeLabel}
          </span>
        </a>
        {attachment.commentText !== null && attachment.commentText.length > 0 ? (
          <p
            className="attachment-comment"
            data-testid="attachment-comment"
          >
            {attachment.commentText}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes.toString()} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(1)} KiB`;
  const mib = kib / 1024;
  return `${mib.toFixed(1)} MiB`;
}

interface MessageEditorProps {
  initialBody: string;
  onCancel: () => void;
  onSave: (bodyText: string) => Promise<void>;
}

function MessageEditor({
  initialBody,
  onCancel,
  onSave,
}: MessageEditorProps): ReactElement {
  const [draft, setDraft] = useState(initialBody);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    // `trim()` is only used to decide whether the draft is effectively
    // empty. The edited body itself is persisted as-typed so leading/
    // trailing spaces and explicit newlines the user chose to keep aren't
    // silently stripped.
    if (draft.trim().length === 0) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save edit';
      setError(msg);
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
      return;
    }
    // Enter saves; Shift+Enter keeps a newline (mirrors the composer's policy).
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  const disableSave = saving || draft.trim().length === 0;

  return (
    <div className="message-editor" data-testid="message-editor">
      <textarea
        className="message-edit-input"
        data-testid="message-edit-input"
        value={draft}
        autoFocus
        rows={2}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onKeyDown={onKeyDown}
        disabled={saving}
      />
      <div className="message-editor-actions">
        <button
          type="button"
          className="message-action"
          data-testid="message-edit-save"
          onClick={() => {
            void submit();
          }}
          disabled={disableSave}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          className="message-action"
          data-testid="message-edit-cancel"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </button>
      </div>
      {error !== null ? (
        <p role="alert" data-testid="message-edit-error" className="message-edit-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
