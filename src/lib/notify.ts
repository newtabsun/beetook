import { showToast } from '../components/DialogHost';
import { MSG_OFFLINE, MSG_WEAK, safeMessage } from './errors';
import { reportNetIssue } from './network';

/** In-app message card. Network problems never toast: the single top banner handles them. */
export function notify(title: string, message?: string) {
  const m = safeMessage(message);
  if (m && (m.startsWith(MSG_OFFLINE) || m.startsWith(MSG_WEAK))) { reportNetIssue(); return; }
  showToast(title, m);
}
