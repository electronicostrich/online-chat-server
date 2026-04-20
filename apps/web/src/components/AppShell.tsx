import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useSession } from '../auth/SessionContext.js';
import { createRealtimeClient } from '../realtime/client.js';
import { ChatView } from './ChatView.js';
import { RoomNav, type OpenChat } from './RoomNav.js';

// AC-UI-01 — Standard chat layout. The shell is always rendered after sign-in
// regardless of whether a chat is selected, so the user always sees:
//   - top menu (banner)
//   - side navigation (rooms / contacts)
//   - central message area
//   - bottom composer
//   - optional right-side context panel (members) when a chat is open
export function AppShell(): ReactElement {
  const { user, signOut } = useSession();
  const [rooms, setRooms] = useState<OpenChat[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  // One websocket per signed-in lifetime of the AppShell. Closing on unmount
  // covers the sign-out path.
  const realtime = useMemo(() => createRealtimeClient(), []);
  useEffect(() => {
    return () => {
      realtime.close();
    };
  }, [realtime]);

  function handleRoomCreated(room: OpenChat): void {
    setRooms((prev) => [...prev, room]);
    setSelectedChatId(room.chatId);
  }

  return (
    <div className="app-shell" data-testid="app-shell">
      <header className="top-menu" data-testid="top-menu" role="banner">
        <div className="top-menu-brand">Chat</div>
        <div className="top-menu-actions">
          <span data-testid="current-user">
            {user !== null ? user.username : 'Account'}
          </span>
          <button
            type="button"
            data-testid="sign-out"
            onClick={() => {
              setSignOutError(null);
              signOut().catch((err: unknown) => {
                const message = err instanceof Error ? err.message : 'Sign out failed';
                setSignOutError(message);
              });
            }}
          >
            Sign out
          </button>
        </div>
        {signOutError !== null ? (
          <p role="alert" data-testid="sign-out-error">
            {signOutError}
          </p>
        ) : null}
      </header>
      <div className="app-shell-body">
        <RoomNav
          rooms={rooms}
          selectedChatId={selectedChatId}
          onSelect={setSelectedChatId}
          onRoomCreated={handleRoomCreated}
        />
        <main className="message-area" data-testid="message-area">
          {selectedChatId === null ? (
            <div className="empty-chat" data-testid="empty-chat">
              <p>Select a room from the side nav, or create a new one.</p>
            </div>
          ) : (
            <ChatView chatId={selectedChatId} realtime={realtime} />
          )}
        </main>
        {selectedChatId !== null ? (
          <aside
            className="right-panel"
            data-testid="right-panel"
            aria-label="Chat context"
          >
            <h2>Members</h2>
            <p>Members panel coming with WS-07 follow-ups.</p>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
