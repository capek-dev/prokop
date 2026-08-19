import type { NotificationSenderPort } from '@/application/ports/notifications';
import {
  getVapidCredentials,
  isWebPushAvailable,
  sendWebPush,
} from './credentials';

export function createWebPushSender(): NotificationSenderPort {
  return {
    send: sendWebPush,
    config() {
      const available = isWebPushAvailable();
      const credentials = available ? getVapidCredentials() : null;
      return {
        available,
        vapidPublicKey: credentials?.publicKey ?? '',
      };
    },
  };
}
