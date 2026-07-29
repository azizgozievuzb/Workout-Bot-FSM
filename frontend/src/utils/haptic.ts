import { hapticFeedback } from '@telegram-apps/sdk-react';

type ImpactStyle = 'light' | 'medium' | 'heavy' | 'rigid' | 'soft';
type NotificationType = 'error' | 'success' | 'warning';

// NB: в @telegram-apps/sdk 3.x hapticFeedback НЕ монтируется — достаточно
// проверки isAvailable() у самого метода (бывший ensureMounted() всегда падал
// в catch: hapticFeedback.mount === undefined).

export function hapticImpact(style: ImpactStyle = 'light') {
  try {
    if (hapticFeedback.impactOccurred.isAvailable()) {
      hapticFeedback.impactOccurred(style);
    }
  } catch { /* silent */ }
}

export function hapticNotification(type: NotificationType) {
  try {
    if (hapticFeedback.notificationOccurred.isAvailable()) {
      hapticFeedback.notificationOccurred(type);
    }
  } catch { /* silent */ }
}

export function hapticSelection() {
  try {
    if (hapticFeedback.selectionChanged.isAvailable()) {
      hapticFeedback.selectionChanged();
    }
  } catch { /* silent */ }
}
