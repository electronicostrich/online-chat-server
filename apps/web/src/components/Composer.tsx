import {
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactElement,
  type SyntheticEvent,
} from 'react';

interface ComposerProps {
  disabled?: boolean;
  onSend: (bodyText: string) => Promise<void> | void;
  // When supplied, the composer exposes a paperclip control that fires a
  // multipart upload for the selected file. `commentText` is whatever the
  // user had typed in the textarea at the time of attaching (AC-ATT-01
  // "optional comment is stored if provided"). If the caller doesn't
  // accept uploads the control is not rendered.
  onAttach?: (file: File, commentText: string | null) => Promise<void> | void;
}

export function Composer({
  disabled = false,
  onSend,
  onAttach,
}: ComposerProps): ReactElement {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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

  async function onFileSelected(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    // Clear the input value immediately so re-picking the same file still
    // fires `change`. React Query handles in-flight dedupe; the composer
    // just needs to not swallow the second selection.
    event.target.value = '';
    if (file === undefined || onAttach === undefined) return;
    const comment = draft.trim().length > 0 ? draft : null;
    setUploading(true);
    setAttachError(null);
    try {
      await onAttach(file, comment);
      setDraft('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setAttachError(msg);
    } finally {
      setUploading(false);
    }
  }

  const controlsDisabled = disabled || sending || uploading;

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
        disabled={controlsDisabled}
      />
      {onAttach !== undefined ? (
        <>
          <input
            ref={fileInputRef}
            type="file"
            data-testid="composer-file-input"
            className="composer-file-input"
            onChange={(event) => {
              void onFileSelected(event);
            }}
            disabled={controlsDisabled}
          />
          <button
            type="button"
            className="composer-attach"
            data-testid="composer-attach"
            onClick={() => {
              fileInputRef.current?.click();
            }}
            disabled={controlsDisabled}
            aria-label="Attach file"
            title="Attach file"
          >
            {uploading ? 'Uploading…' : 'Attach'}
          </button>
        </>
      ) : null}
      <button
        type="submit"
        className="composer-send"
        data-testid="composer-send"
        disabled={controlsDisabled || draft.trim().length === 0}
      >
        {sending ? 'Sending…' : 'Send'}
      </button>
      {attachError !== null ? (
        <p
          role="alert"
          className="composer-error"
          data-testid="composer-attach-error"
        >
          {attachError}
        </p>
      ) : null}
    </form>
  );
}
