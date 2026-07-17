import React, { useEffect, useState } from 'react';
import type { AccessTier } from '../../stores/authStore';
import { useAuthStore } from '../../stores/authStore';
import { getTierPrices, createTierInvoice } from '../../api/payments';
import type { TierPrice } from '../../api/payments';
import { pollPayment, openStarInvoice } from '../../utils/starPayment';
import { hapticNotification } from '../../utils/haptic';

const TIER_META: Record<AccessTier, { title: string; limit: number }> = {
  standard: { title: 'Standard', limit: 1 },
  premium: { title: 'Premium', limit: 2 },
  elite: { title: 'Elite', limit: 3 },
};

const PaywallScreen: React.FC = () => {
  const { subscription } = useAuthStore();
  const isCustom = subscription?.pricing_mode === 'custom';
  const [prices, setPrices] = useState<TierPrice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>('');

  useEffect(() => {
    if (isCustom) { setLoading(false); return; }
    getTierPrices()
      .then(setPrices)
      .catch(() => setStatus('Не удалось загрузить тарифы'))
      .finally(() => setLoading(false));
  }, [isCustom]);

  const pay = async (tier: AccessTier) => {
    if (busy) return;
    setBusy(true);
    setStatus('');
    try {
      // First payment: intro month (custom accounts pay 1m at their custom price).
      const { payment_id, invoice_link } = await createTierInvoice(tier, isCustom ? '1m' : 'intro');
      const opened = openStarInvoice(invoice_link, async (st: string) => {
        if (st === 'paid') {
          setStatus('Оплата получена, активируем подписку...');
          const res = await pollPayment(payment_id);
          if (res === 'fulfilled') {
            hapticNotification('success');
            setStatus('✅ Подписка активна!');
            setTimeout(() => window.location.reload(), 1200);
            return;
          }
          setStatus('Оплата обрабатывается — подписка активируется автоматически.');
          setTimeout(() => window.location.reload(), 2500);
        } else if (st === 'cancelled') {
          setStatus('Покупка отменена');
        } else {
          setStatus('Оплата не прошла');
        }
        setBusy(false);
      });
      if (!opened) {
        setStatus('Оплата недоступна в этом клиенте');
        setBusy(false);
      }
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      setStatus(typeof detail === 'string' ? detail : detail?.code ?? 'Не удалось создать счёт');
      hapticNotification('error');
      setBusy(false);
    }
  };

  return (
    <div className="paywall-screen">
      <div className="paywall-inner">
        <h1 className="paywall-title">Выберите тариф</h1>
        <p className="paywall-sub">
          Оплата — звёздами Telegram. Вы становитесь Ответственным и приглашаете игроков.
        </p>

        {loading && <div className="paywall-loading">Загрузка…</div>}

        {isCustom && !loading && (
          <button className="paywall-cta" disabled={busy} onClick={() => pay(subscription?.tier ?? 'standard')}>
            {busy ? 'Открываю оплату…' : 'Оплатить подписку ⭐'}
          </button>
        )}

        {!isCustom && !loading && prices.map((p) => {
          const meta = TIER_META[p.tier];
          return (
            <div key={p.tier} className="paywall-card">
              <div className="paywall-card-head">
                <span className="paywall-card-title">{meta.title}</span>
                <span className="paywall-card-limit">до {meta.limit} игрок(ов)</span>
              </div>
              <button className="paywall-cta" disabled={busy} onClick={() => pay(p.tier)}>
                {busy ? '…' : `Оплатить · ${p.intro_price_stars} ⭐ / первый месяц`}
              </button>
            </div>
          );
        })}

        <p className="paywall-hint">
          Хотите быть игроком? Попросите наставника прислать вам приглашение.
        </p>
        {status && <div className="paywall-status">{status}</div>}
      </div>
    </div>
  );
};

export default PaywallScreen;
