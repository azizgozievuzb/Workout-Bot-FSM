import { hapticFeedback } from '@telegram-apps/sdk-react';

type ImpactStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';
type NotificationType = 'error' | 'success' | 'warning';

function ensureMounted() {
  try {
    if (hapticFeedback.mount.isAvailable() && !hapticFeedback.isMounted()) {
      hapticFeedback.mount();
    }
  } catch { /* silent */ }
}

export function hapticImpact(style: ImpactStyle = 'light') {
  ensureMounted();
  try {
    if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred(style);
    }
  } catch { /* silent */ }
}

export function hapticNotification(type: NotificationType) {
  ensureMounted();
  try {
    if (hapticFeedback.notificationOccurred.isAvailable()) {
      hapticFeedback.notificationOccurred(type);
    }
  } catch { /* silent */ }
}

export function hapticSelection() {
  ensureMounted();
  try {
    if (hapticFeedback.selectionChanged.isAvailable()) {
      hapticFeedback.selectionChanged();
    }
  } catch { /* silent */ }
}
