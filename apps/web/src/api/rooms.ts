import type { CreateRoomRequest, CreateRoomResponse } from 'shared-schemas';
import { apiRequest } from './client.js';

type CreateRoomData = CreateRoomResponse['data'];

export async function createRoom(input: CreateRoomRequest): Promise<CreateRoomData> {
  return apiRequest<CreateRoomData>('/rooms', {
    method: 'POST',
    body: input,
  });
}
