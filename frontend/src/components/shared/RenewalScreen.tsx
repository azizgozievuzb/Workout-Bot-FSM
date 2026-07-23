import React, { useEffect, useState } from 'react';
import api, { setToken } from '../../api/client';
import type { AccessTier } from '../../stores/authStore';
import { useAuthStore } from '../../stores/authStore';
import { getTierPrices, createTierInvoice, previewCoupon } from '../../api/payments';
import type { TierPrice, SubscriptionPeriod, CouponPreview } from '../../api/payments';
import { getMyPlayers } from '../../api/partnerships';
import { pollPayment, openStarInvoice } from '../../utils/starPayment';
import { hapticNotification } from '../../utils/haptic';
import { TIER_LIMIT_LABEL } from '../../utils/tierText';
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

// Map backend error codes (coupon-preview + tier-invoice) to Russian text —
// never surface a raw code to the user.
function couponErrText(code?: string | null): string {
  switch (code) {
    case 'COUPON_ALREADY_USED':
      return 'Купон уже использован';
    case 'COUPON_INVALID':
    case 'COUPON_EXPIRED':
    case 'COUPON_EXHAUSTED':
    case 'PRICE_UNSET':
      return 'Купон недействителен';
    default:
      return 'Не удалось создать счёт';
  }
}

interface RenewalScreenProps {
  onClose?: () => void;
}

const RenewalScreen: React.FC<RenewalScreenProps> = ({ onClose }) => {
  const { subscription } = useAuthStore();
  const isCustom = subscription?.pricing_mode === 'custom';
  const isFree = subscription?.pricing_mode === 'free';
  const [prices, setPrices] = useState<TierPrice[]>([]);
  const [tier, setTier] = useState<AccessTier>(subscription?.tier ?? 'standard');
  const [period, setPeriod] = useState<SubscriptionPeriod>('1m');
  const [coupon, setCoupon] = useState('');
  const [preview, setPreview] = useState<CouponPreview | null>(null);
  const [couponChecking, setCouponChecking] = useState(false);
  const [playerCount, setPlayerCount] = useState(0);
  const [showDowngrade, setShowDowngrade] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    // Free access: no prices/players needed — just render the info state.
    if (isFree) { setLoading(false); return; }
    Promise.all([getTierPrices(), getMyPlayers().catch(() => [])])
      .then(([tp, players]) => {
        setPrices(tp);
        setPlayerCount(players.length);
      })
      .catch(() => setStatus('Не удалось загрузить данные'))
      .finally(() => setLoading(false));
  }, [isFree]);

  // Live coupon recalculation — server is the single source of truth for validity.
  useEffect(() => {
    if (isCustom) { setPreview(null); setCouponChecking(false); return; }
    const code = coupon.trim();
    if (!code) { setPreview(null); setCouponChecking(false); return; }
    let cancelled = false;
    setCouponChecking(true);
    const t = setTimeout(() => {
      previewCoupon(code, tier, period as '1m' | '3m' | '12m')
        .then((r) => { if (!cancelled) { setPreview(r); setCouponChecking(false); } })
        .catch(() => { if (!cancelled) { setPreview(null); setCouponChecking(false); } });
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [coupon, tier, period, isCustom]);

  // Overlay mode (entered from BondCube): refresh subscription/tier in place —
  // same auth request App uses at start — instead of reloading the whole app,
  // which would drop the user back to the main screen.
  const refreshAuthInPlace = async (): Promise<void> => {
    const initData = window.Telegram?.WebApp?.initData;
    if (!initData) return;
    const { data } = await api.post('/auth/telegram', { init_data: initData });
    setToken(data.access_token);
    useAuthStore.getState().setAuth({
      token: data.access_token,
      role: data.role,
      primary_role: data.primary_role,
      has_player_access: data.has_player_access,
      has_responsible_access: data.has_responsible_access,
      is_admin: data.is_admin,
      onboardingDone: data.onboarding_done,
      photoUrl: data.profile_photo_url,
      photoDarkUrl: data.photo_dark_url,
      photoLightUrl: data.photo_light_url,
      own_access_tier: data.own_access_tier ?? null,
      player_view_tier: data.player_view_tier ?? null,
      shop_freeze_balance: data.shop_freeze_balance ?? 0,
      gift_freeze_balance: data.gift_freeze_balance ?? 0,
      streak_freeze_balance: data.streak_freeze_balance ?? 0,
      rest_days_remaining: data.rest_days_remaining ?? 0,
      has_active_partnerships: data.has_active_partnerships ?? false,
      days_left: data.days_left ?? null,
      unread_notifications: data.unread_notifications ?? 0,
      gender: data.gender ?? null,
      subscription: data.subscription ?? null,
    });
  };

  const priceRow = prices.find((p) => p.tier === tier);
  const selectedPrice = priceRow
    ? Number(priceRow[PERIODS.find((x) => x.key === period)!.col])
    : null;
  const finalPrice = preview?.valid ? preview.final_price : selectedPrice;
  const targetLimit = TIER_META[tier].limit;
  const overLimit = playerCount > targetLimit;
  const couponRejected = !!coupon.trim() && !!preview && !preview.valid;

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
            if (onClose) {
              await refreshAuthInPlace().catch(() => {});
              setTimeout(() => onClose(), 1200);
            } else {
              setTimeout(() => window.location.reload(), 1200);
            }
            return;
          }
          setStatus('Оплата обрабатывается — подписка активируется автоматически.');
          if (onClose) {
            await refreshAuthInPlace().catch(() => {});
            setTimeout(() => onClose(), 2500);
          } else {
            setTimeout(() => window.location.reload(), 2500);
          }
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
      const code = typeof detail === 'object' ? detail?.code : detail;
      if (code === 'DOWNGRADE_BLOCKED') {
        setShowDowngrade(true);
        setBusy(false);
        return;
      }
      setStatus(typeof detail === 'string' ? detail : couponErrText(code));
      hapticNotification('error');
      setBusy(false);
    }
  };

  return (
    <div className="paywall-screen">
      {onClose && (
        <button className="paywall-close" onClick={onClose} aria-label="Закрыть">✕</button>
      )}
      <div className="paywall-inner">
        <h1 className="paywall-title">Продление подписки</h1>
        {!isFree && <p className="paywall-sub">Выберите тариф и период. Оплата — звёздами Telegram.</p>}

        {loading && <div className="paywall-loading">Загрузка…</div>}

        {isFree && !loading && (() => {
          const t = subscription?.tier ?? tier;
          return (
            <>
              <h2 className="paywall-sub" style={{ fontWeight: 600, marginTop: 4 }}>Персональный доступ</h2>
              <p className="paywall-sub">
                ✨ Вам предоставлен бесплатный доступ — тариф {TIER_META[t].title} · до {TIER_META[t].limit} игроков.
                Оплата не требуется.
              </p>
            </>
          );
        })()}

        {isCustom && !isFree && !loading && (
          <button className="paywall-cta" disabled={busy} onClick={pay}>
            {busy ? 'Открываю оплату…' : 'Продлить (персональная цена) ⭐'}
          </button>
        )}

        {!isCustom && !isFree && !loading && (
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
            <p className="renew-tier-hint">{TIER_LIMIT_LABEL[tier]}</p>

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
              onChange={(e) => { setCoupon(e.target.value.toUpperCase()); setStatus(''); }}
            />

            {coupon.trim() && preview && (
              preview.valid ? (
                <div className="renew-coupon-ok">
                  Купон −{preview.pct}% → итого {preview.final_price} ⭐
                </div>
              ) : (
                <div className="renew-coupon-err">
                  {couponErrText(preview.code)}
                </div>
              )
            )}

            {overLimit && (
              <div className="renew-warn">
                Тариф {TIER_META[tier].title} допускает {targetLimit} игрок(ов), у вас {playerCount}.
                Нужно удалить лишних.
              </div>
            )}

            <button className="paywall-cta" disabled={busy || couponChecking || couponRejected} onClick={pay}>
              {overLimit
                ? 'Выбрать, кого удалить'
                : couponChecking
                  ? 'Проверяю купон…'
                  : busy
                    ? 'Открываю оплату…'
                    : `Оплатить${finalPrice ? ` · ${finalPrice} ⭐` : ''}`}
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
