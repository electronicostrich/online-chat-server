import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
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
}

export function MessageList({ messages }: MessageListProps): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Mutable so the layout effect can read the latest user-position bit
  // without re-subscribing on every render.
  const isAtBottomRef = useRef(true);
  const lastSeenSequenceRef = useRef<number>(0);
  const [unreadBelow, setUnreadBelow] = useState(0);

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
            <article
              key={message.id}
              className={`message${message.deletedAt !== null ? ' message-deleted' : ''}`}
              data-testid="message"
              data-sequence={message.sequence.toString()}
            >
              <div className="message-meta">
                <span className="message-author">{message.authorUserId.slice(0, 8)}</span>
                <time dateTime={message.createdAt}>
                  {new Date(message.createdAt).toLocaleTimeString()}
                </time>
              </div>
              <div className="message-body">
                {message.deletedAt !== null
                  ? '(deleted)'
                  : (message.bodyText ?? '')}
              </div>
            </article>
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
