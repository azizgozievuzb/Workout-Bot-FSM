import { getPayment } from '../api/payments';

/** Poll our own DB — the Telegram callback status is NOT the source of truth. */
export async function pollPayment(paymentId: string): Promise<string> {
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const { status } = await getPayment(paymentId);
      if (status === 'fulfilled') return 'fulfilled';
      if (status === 'failed' || status === 'refunded') return status;
    } catch {
      /* keep polling */
    }
  }
  return 'timeout';
}

/** Opens the native Stars invoice. Returns false if the client can't pay. */
export function openStarInvoice(
  invoiceLink: string,
  onResult: (status: string) => void,
): boolean {
  const tg = (window as any).Telegram?.WebApp;
  if (!tg?.openInvoice) return false;
  tg.openInvoice(invoiceLink, onResult);
  return true;
}
