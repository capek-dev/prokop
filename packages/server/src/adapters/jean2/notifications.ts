import { getPermissionTimeoutMs } from '@/env';
import { getSession } from '@/store/sessions';
import { getScheduledJob } from '@/store/scheduled-jobs';
import { getPermissionRequestByRequestId } from '@/store/pending-asks';
import { createNotificationRepository } from '@/infrastructure/sqlite/notification-repository';
import { createWebPushSender } from '@/infrastructure/web-push/sender';
import { canNotifyForSession as scheduledSessionCanNotify } from '@/domains/scheduling/notifications';
import {
  createNotificationsApplication,
  type NotificationsApplication,
} from '@/application/notifications';

/**
 * Jean2 notification adapter (S4/S5). Wires the notification application to
 * the current store and web-push implementations. The scheduled-run
 * eligibility predicate comes from the scheduling domain (shared policy,
 * not duplicated). A module-level singleton keeps the pending-terminal
 * dispatch map shared between the wired application, the compat dispatch
 * module, and the transport ack handler.
 */

let singleton: NotificationsApplication | null = null;

export function getJean2NotificationsApplication(): NotificationsApplication {
  if (singleton) {
    return singleton;
  }

  const store = createNotificationRepository();
  const sender = createWebPushSender();

  singleton = createNotificationsApplication({
    store,
    sender,
    getSession,
    canNotifyForSession: (session) => scheduledSessionCanNotify(session, (id) => getScheduledJob(id)),
    getPendingAsk: getPermissionRequestByRequestId,
    permissionTimeoutMs: getPermissionTimeoutMs,
  });

  return singleton;
}
