import { useState, type ReactElement, type SyntheticEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ApiError } from '../api/client.js';
import { createRoom } from '../api/rooms.js';

export interface OpenChat {
  chatId: string;
  name: string;
}

interface RoomNavProps {
  rooms: OpenChat[];
  selectedChatId: string | null;
  onSelect: (chatId: string) => void;
  onRoomCreated: (room: OpenChat) => void;
}

export function RoomNav({
  rooms,
  selectedChatId,
  onSelect,
  onRoomCreated,
}: RoomNavProps): ReactElement {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (roomName: string) =>
      createRoom({ name: roomName, visibility: 'private' }),
    onSuccess: ({ room }) => {
      onRoomCreated({ chatId: room.chatId, name: room.name });
      setName('');
      setError(null);
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to create room.');
      }
    },
  });

  function onSubmit(event: SyntheticEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    createMutation.mutate(trimmed);
  }

  return (
    <nav className="side-nav" data-testid="side-nav" aria-label="Rooms and contacts">
      <div className="side-nav-section">
        <h2>Rooms</h2>
        <ul className="side-nav-list" data-testid="room-list">
          {rooms.length === 0 ? (
            <li className="side-nav-empty" data-testid="room-list-empty">
              No rooms yet
            </li>
          ) : (
            rooms.map((room) => (
              <li key={room.chatId}>
                <button
                  type="button"
                  className={`side-nav-item${
                    selectedChatId === room.chatId ? ' side-nav-item-selected' : ''
                  }`}
                  data-testid="room-list-item"
                  data-chat-id={room.chatId}
                  onClick={() => {
                    onSelect(room.chatId);
                  }}
                >
                  {room.name}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
      <form className="create-room" data-testid="create-room-form" onSubmit={onSubmit}>
        <label className="field">
          <span>Create room</span>
          <input
            type="text"
            data-testid="create-room-name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            minLength={2}
            maxLength={64}
          />
        </label>
        <button
          type="submit"
          data-testid="create-room-submit"
          disabled={createMutation.isPending || name.trim().length === 0}
        >
          {createMutation.isPending ? 'Creating…' : 'Create'}
        </button>
        {error !== null ? (
          <p role="alert" data-testid="create-room-error" className="side-nav-error">
            {error}
          </p>
        ) : null}
      </form>
    </nav>
  );
}
