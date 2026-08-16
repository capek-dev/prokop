/**
 * Temporary forwarding module (S2).
 *
 * The wire handlers now live in `transport/websocket/handlers`.
 */
export {
  handlePermissionList,
  handlePermissionRevoke,
  handlePermissionRevokeAll,
} from '@/transport/websocket/handlers/permissions';
