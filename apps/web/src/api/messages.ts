import type {
  ListMessagesQuery,
  ListMessagesResponse,
  SendMessageRequest,
  SendMessageResponse,
} from 'shared-schemas';
import { apiRequest } from './client.js';

type ListMessagesData = ListMessagesResponse['data'];
type SendMessageData = SendMessageResponse['data'];

function buildQuery(query: ListMessagesQuery | undefined): string {
  if (query === undefined) return '';
  const params: string[] = [];
  if (query.beforeSequence !== undefined) {
    params.push(`beforeSequence=${query.beforeSequence.toString()}`);
  }
  if (query.afterSequence !== undefined) {
    params.push(`afterSequence=${query.afterSequence.toString()}`);
  }
  if (query.limit !== undefined) {
    params.push(`limit=${query.limit.toString()}`);
  }
  return params.length === 0 ? '' : `?${params.join('&')}`;
}

export async function listChatMessages(
  chatId: string,
  query?: ListMessagesQuery,
): Promise<ListMessagesData> {
  return apiRequest<ListMessagesData>(`/chats/${chatId}/messages${buildQuery(query)}`);
}

export async function sendChatMessage(
  chatId: string,
  input: SendMessageRequest,
): Promise<SendMessageData> {
  return apiRequest<SendMessageData>(`/chats/${chatId}/messages`, {
    method: 'POST',
    body: input,
  });
}
