import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import type { MessagePublic } from 'shared-schemas';

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
}

export function MessageList({
  messages,
  currentUserId,
  onEdit,
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
      isAtBottomRef.current = atBottom;
      // Mirror the at-bottom flag onto a DOM attribute so Playwright specs
      // can `await expect(...).toHaveAttribute('data-at-bottom', 'false')`
      // instead of sleeping after a programmatic scroll.
      el.setAttribute('data-at-bottom', atBottom ? 'true' : 'false');
      if (atBottom) {
        setUnreadBelow(0);
        if (messages.length > 0) {
          const last = messages[messages.length - 1];
          if (last !== undefined) lastSeenSequenceRef.current = last.sequence;
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
  }, [messages]);

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
      if (last !== undefined) lastSeenSequenceRef.current = last.sequence;
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
  isOwn: boolean;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (bodyText: string) => Promise<void>;
}

function MessageRow({
  message,
  isOwn,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
}: MessageRowProps): ReactElement {
  const isDeleted = message.deletedAt !== null;
  const canEdit = isOwn && !isDeleted;

  return (
    <article
      className={`message${isDeleted ? ' message-deleted' : ''}`}
      data-testid="message"
      data-sequence={message.sequence.toString()}
      data-message-id={message.id}
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
          <div className="message-body" data-testid="message-body">
            {isDeleted ? '(deleted)' : (message.bodyText ?? '')}
          </div>
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
    const trimmed = draft.trim();
    if (trimmed.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(trimmed);
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
