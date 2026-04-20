import { useState, type KeyboardEvent, type ReactElement, type SyntheticEvent } from 'react';

interface ComposerProps {
  disabled?: boolean;
  onSend: (bodyText: string) => Promise<void> | void;
}

export function Composer({ disabled = false, onSend }: ComposerProps): ReactElement {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  async function submit(): Promise<void> {
    const trimmed = draft.trim();
    if (trimmed.length === 0) return;
    setSending(true);
    try {
      await onSend(trimmed);
      setDraft('');
    } finally {
      setSending(false);
    }
  }

  function onSubmit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    void submit();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    // Enter sends; Shift+Enter inserts a newline (multi-line is allowed by
    // AC-MSG-01). The 3 KB byte cap (AC-MSG-02) is enforced server-side.
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <form className="composer" data-testid="composer" onSubmit={onSubmit}>
      <textarea
        className="composer-input"
        data-testid="composer-input"
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onKeyDown={onKeyDown}
        rows={2}
        placeholder="Type a message"
        disabled={disabled || sending}
      />
      <button
        type="submit"
        className="composer-send"
        data-testid="composer-send"
        disabled={disabled || sending || draft.trim().length === 0}
      >
        {sending ? 'Sending…' : 'Send'}
      </button>
    </form>
  );
}
