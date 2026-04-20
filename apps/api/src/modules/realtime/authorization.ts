import {
  loadChatContext,
  isActiveRoomMember,
} from '../messages/repository.js';

// Re-verifies that a user currently has read access to a chat. Used
// both at subscribe time (to reject unauthorized subscriptions) and at
// fan-out time (to drop events destined for sockets whose access was
// revoked after the subscription landed — room removal, ban, chat
// deletion, etc.). Does not mutate subscription state; callers may
// choose to clear a stale subscription when this returns false.
export async function userCanReadChat(
  chatId: string,
  userId: string,
): Promise<boolean> {
  const ctx = await loadChatContext(chatId);
  if (ctx === undefined) return false;
  if (ctx.chat.type === 'room') {
    const membership = await isActiveRoomMember(chatId, userId);
    return membership !== undefined;
  }
  return (
    ctx.directParticipantIds !== null &&
    ctx.directParticipantIds.includes(userId)
  );
}
