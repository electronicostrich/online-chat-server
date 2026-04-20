export { roomsRoutes } from './routes.js';
export { RoomError } from './errors.js';
export { normalizeRoomName } from './normalize.js';
export {
  createRoom,
  deleteRoom,
  fetchPublicRoomsPage,
  joinPublicRoom,
  leaveRoomAsMember,
  listRoomBans,
  makeMemberAdmin,
  removeAdminStatus,
  removeMember,
  toPublicRoom,
  unbanRoomUser,
} from './service.js';
