import React, { useEffect, useState } from 'react';
import type { AccessTier } from '../../stores/authStore';
import { useAuthStore } from '../../stores/authStore';
import { getTierPrices, createTierInvoice } from '../../api/payments';
import type { TierPrice, SubscriptionPeriod } from '../../api/payments';
import { getMyPlayers } from '../../api/partnerships';
import { pollPayment, openStarInvoice } from '../../utils/starPayment';
import { hapticNotification } from '../../utils/haptic';
import TierDowngradeModal from '../cubes/TierDowngradeModal';

const TIER_META: Record<AccessTier, { title: string; limit: number }> = {
  standard: { title: 'Standard', limit: 1 },
  premium: { title: 'Premium', limit: 2 },
  elite: { title: 'Elite', limit: 3 },
};

const PERIODS: { key: SubscriptionPeriod; label: string; col: keyof TierPrice }[] = [
  { key: '1m', label: '1 месяц', col: 'price_1m' },
  { key: '3m', label: '3 месяца', col: 'price_3m' },
  { key: '12m', label: '12 месяцев', col: 'price_12m' },
];

const RenewalScreen: React.FC = () => {
  const { subscription } = useAuthStore();
  const isCustom = subscription?.pricing_mode === 'custom';
  const [prices, setPrices] = useState<TierPrice[]>([]);
  const [tier, setTier] = useState<AccessTier>(subscription?.tier ?? 'standard');
  const [period, setPeriod] = useState<SubscriptionPeriod>('1m');
  const [coupon, setCoupon] = useState('');
  const [playerCount, setPlayerCount] = useState(0);
  const [showDowngrade, setShowDowngrade] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    Promise.all([getTierPrices(), getMyPlayers().catch(() => [])])
      .then(([tp, players]) => {
        setPrices(tp);
        setPlayerCount(players.length);
      })
      .catch(() => setStatus('Не удалось загрузить данные'))
      .finally(() => setLoading(false));
  }, []);

  const priceRow = prices.find((p) => p.tier === tier);
  const selectedPrice = priceRow
    ? Number(priceRow[PERIODS.find((x) => x.key === period)!.col])
    : null;
  const targetLimit = TIER_META[tier].limit;
  const overLimit = playerCount > targetLimit;

  const pay = async () => {
    if (busy) return;
    if (overLimit) { setShowDowngrade(true); return; }
    setBusy(true);
    setStatus('');
    try {
      const { payment_id, invoice_link } = await createTierInvoice(
        tier, isCustom ? '1m' : period, coupon.trim() || undefined,
      );
      const opened = openStarInvoice(invoice_link, async (st: string) => {
        if (st === 'paid') {
          setStatus('Оплата получена…');
          const res = await pollPayment(payment_id);
          if (res === 'fulfilled') {
            hapticNotification('success');
            setStatus('✅ Подписка продлена!');
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
      if (!opened) { setStatus('Оплата недоступна в этом клиенте'); setBusy(false); }
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
        <h1 className="paywall-title">Продление подписки</h1>
        <p className="paywall-sub">Выберите тариф и период. Оплата — звёздами Telegram.</p>

        {loading && <div className="paywall-loading">Загрузка…</div>}

        {isCustom && !loading && (
          <button className="paywall-cta" disabled={busy} onClick={pay}>
            {busy ? 'Открываю оплату…' : 'Продлить (персональная цена) ⭐'}
          </button>
        )}

        {!isCustom && !loading && (
          <>
            <div className="renew-row">
              {(['standard', 'premium', 'elite'] as AccessTier[]).map((t) => (
                <button
                  key={t}
                  className={`renew-chip ${tier === t ? 'active' : ''}`}
                  onClick={() => setTier(t)}
                >
                  {TIER_META[t].title}
                </button>
              ))}
            </div>

            <div className="renew-row">
              {PERIODS.map((pr) => (
                <button
                  key={pr.key}
                  className={`renew-chip ${period === pr.key ? 'active' : ''}`}
                  onClick={() => setPeriod(pr.key)}
                >
                  {pr.label}
                  {priceRow && <span className="renew-chip-price"> · {String(priceRow[pr.col])} ⭐</span>}
                </button>
              ))}
            </div>

            <input
              className="renew-coupon"
              placeholder="Промокод (необязательно)"
              value={coupon}
              onChange={(e) => setCoupon(e.target.value.toUpperCase())}
            />

            {overLimit && (
              <div className="renew-warn">
                Тариф {TIER_META[tier].title} допускает {targetLimit} игрок(ов), у вас {playerCount}.
                Нужно удалить лишних.
              </div>
            )}

            <button className="paywall-cta" disabled={busy} onClick={pay}>
              {overLimit
                ? 'Выбрать, кого удалить'
                : busy
                  ? 'Открываю оплату…'
                  : `Оплатить${selectedPrice ? ` · ${selectedPrice} ⭐` : ''}`}
            </button>
          </>
        )}

        {status && <div className="paywall-status">{status}</div>}
      </div>

      {showDowngrade && (
        <TierDowngradeModal
          targetTier={tier}
          onClose={() => setShowDowngrade(false)}
          onSuccess={() => { setShowDowngrade(false); setPlayerCount(targetLimit); }}
        />
      )}
    </div>
  );
};

export default RenewalScreen;
