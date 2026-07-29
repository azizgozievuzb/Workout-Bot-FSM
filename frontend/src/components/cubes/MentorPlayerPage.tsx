import React, { useCallback, useEffect, useState } from 'react';
import {
    createPromise, createStarItemInvoice, deleteShelfItem, getItemVideoUrl,
    getPlayerPage, giftDrops, patchShelfItem,
} from '../../api/shelf';
import type { PlayerPage, ShelfItem } from '../../api/shelf';
import { openStarInvoice, pollPayment } from '../../utils/starPayment';
import { hapticImpact, hapticNotification } from '../../utils/haptic';
import PromiseRecorder from './PromiseRecorder';
import DropPackModal from './DropPackModal';
import GiftFreezeModal from './GiftFreezeModal';
import '../../styles/shelf.css';

/* 8d: полноценная СТРАНИЦА игрока в панели наставника (находка №9 смоука 8c) —
   дом управления полкой. Баланс капель игрока здесь НЕ показывается (§8.7). */

interface Props {
    playerId: string;
    onClose: () => void;
}

const STATUS_LABEL: Record<string, string> = {
    active: 'на полке',
    hidden: 'скрыт игроком',
    purchased: 'ждёт исполнения',
};

function fmtDate(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('ru-RU');
}

const MentorPlayerPage: React.FC<Props> = ({ playerId, onClose }) => {
    const [page, setPage] = useState<PlayerPage | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [toast, setToast] = useState('');

    const [promiseForm, setPromiseForm] = useState(false);
    const [recorder, setRecorder] = useState(false);
    const [recError, setRecError] = useState('');
    const [upProgress, setUpProgress] = useState<number | null>(null);
    const [pTitle, setPTitle] = useState('');
    const [pPrice, setPPrice] = useState('');
    const [starForm, setStarForm] = useState<{ key: string; title: string; stars: number } | null>(null);
    const [starPrice, setStarPrice] = useState('');
    const [giftForm, setGiftForm] = useState(false);
    const [giftAmount, setGiftAmount] = useState('');
    const [packs, setPacks] = useState(false);
    const [freezeGift, setFreezeGift] = useState(false);
    const [editing, setEditing] = useState<{ id: string; price: string } | null>(null);

    const show = useCallback((m: string) => {
        setToast(m);
        setTimeout(() => setToast(''), 3500);
    }, []);

    const load = useCallback(() => {
        setLoading(true);
        getPlayerPage(playerId)
            .then(setPage)
            .catch(() => show('Не удалось загрузить страницу игрока'))
            .finally(() => setLoading(false));
    }, [playerId, show]);

    useEffect(() => { load(); }, [load]);

    const fail = useCallback((e: any, fallback: string) => {
        hapticNotification('error');
        const d = e?.response?.data?.detail;
        const code = typeof d === 'object' ? d?.code : '';
        if (code === 'PRICE_OUT_OF_LIMITS') show(`Цена должна быть от ${d.min} до ${d.max} 💧`);
        else if (code === 'NO_FREE_SLOT') show(`Свободных слотов нет (${d.used}/${d.total})`);
        else if (code === 'INSUFFICIENT_GIFT_BALANCE') show(`В пуле только ${d.gift_balance} 💧 — пополните`);
        else if (code === 'SUBSCRIPTION_INACTIVE') show('Подписка неактивна — продлите её');
        else show(fallback);
    }, [show]);

    /* ---------- Обещание ---------- */
    const submitPromise = useCallback(async (blob: Blob) => {
        const price = parseInt(pPrice, 10);
        if (!page) return;
        setBusy(true); setRecError(''); setUpProgress(0);
        try {
            await createPromise({
                playerId, title: pTitle.trim(), priceDrops: price, video: blob,
                onProgress: setUpProgress,
            });
            hapticNotification('success');
            show('🎁 Обещание на полке');
            setRecorder(false); setPromiseForm(false); setPTitle(''); setPPrice('');
            load();
        } catch (e: any) {
            // Экран записи НЕ закрываем — показываем причину прямо в нём,
            // иначе тост уезжает под оверлей и отказ выглядит как «ничего не произошло».
            hapticNotification('error');
            const d = e?.response?.data?.detail;
            const code = typeof d === 'object' ? d?.code : '';
            const status = e?.response?.status;
            console.error('[shelf] createPromise failed', status, d ?? e?.message);
            setRecError(
                code === 'PRICE_OUT_OF_LIMITS' ? `Цена должна быть от ${d.min} до ${d.max} 💧`
                    : code === 'NO_FREE_SLOT' ? `Свободных слотов нет (${d.used}/${d.total})`
                        : code === 'VIDEO_TOO_LARGE' ? 'Видео больше 30 МБ — снимите короче'
                            : code === 'STORAGE_FAILED' ? 'Хранилище отвергло файл. Попробуйте ещё раз'
                                : e?.code === 'ECONNABORTED' ? 'Загрузка не уложилась в таймаут — попробуйте ещё раз'
                                    : `Не удалось создать обещание${status ? ` (HTTP ${status})` : ''}`,
            );
        }
        finally { setBusy(false); setUpProgress(null); }
    }, [page, playerId, pTitle, pPrice, show, load]);

    const promiseValid = (() => {
        if (!page) return false;
        const price = parseInt(pPrice, 10);
        return pTitle.trim().length >= 2
            && Number.isFinite(price)
            && price >= page.price_limits.min && price <= page.price_limits.max;
    })();

    /* ---------- Stars-предмет ---------- */
    const buyStarItem = useCallback(async () => {
        if (!starForm || !page || busy) return;
        const price = parseInt(starPrice, 10);
        if (!Number.isFinite(price) || price < page.price_limits.min || price > page.price_limits.max) {
            show(`Цена должна быть от ${page.price_limits.min} до ${page.price_limits.max} 💧`);
            return;
        }
        setBusy(true);
        try {
            const { payment_id, invoice_link } = await createStarItemInvoice(playerId, starForm.key, price);
            const opened = openStarInvoice(invoice_link, async (status) => {
                if (status === 'paid') {
                    show('Оплата получена, выставляем на полку…');
                    const res = await pollPayment(payment_id);
                    if (res === 'fulfilled') { hapticNotification('success'); show('🎁 Предмет на полке'); load(); }
                    else show(res === 'timeout' ? 'Оплата обрабатывается — предмет появится сам' : 'Не удалось выставить предмет');
                } else {
                    show(status === 'cancelled' ? 'Покупка отменена' : 'Оплата не прошла');
                }
                setBusy(false); setStarForm(null); setStarPrice('');
            });
            if (!opened) { show('Оплата недоступна в этом клиенте'); setBusy(false); }
        } catch (e) { fail(e, 'Не удалось создать счёт'); setBusy(false); }
    }, [starForm, starPrice, page, busy, playerId, show, fail, load]);

    /* ---------- Лоты ---------- */
    const savePrice = useCallback(async () => {
        if (!editing || busy) return;
        const price = parseInt(editing.price, 10);
        setBusy(true);
        try {
            await patchShelfItem(editing.id, { price_drops: price });
            hapticNotification('success');
            setEditing(null);
            load();
        } catch (e) { fail(e, 'Не удалось изменить цену'); }
        finally { setBusy(false); }
    }, [editing, busy, fail, load]);

    const republish = useCallback(async (item: ShelfItem) => {
        if (busy) return;
        setBusy(true);
        try {
            await patchShelfItem(item.id, { status: 'active' });
            hapticNotification('success');
            show('Лот снова на полке');
            load();
        } catch (e) { fail(e, 'Не удалось перевыставить'); }
        finally { setBusy(false); }
    }, [busy, show, fail, load]);

    const removeItem = useCallback(async (item: ShelfItem) => {
        if (busy) return;
        setBusy(true);
        try {
            await deleteShelfItem(item.id);
            show('Лот убран с полки');
            load();
        } catch (e) { fail(e, 'Не удалось убрать лот'); }
        finally { setBusy(false); }
    }, [busy, show, fail, load]);

    const openVideo = useCallback(async (item: ShelfItem, kind: 'promise' | 'report') => {
        try {
            const url = await getItemVideoUrl(item.id, kind);
            const tg = (window as any).Telegram?.WebApp;
            if (tg?.openLink) tg.openLink(url); else window.open(url, '_blank');
        } catch { show('Видео недоступно'); }
    }, [show]);

    /* ---------- Дарение капель ---------- */
    const doGift = useCallback(async () => {
        if (busy || !page) return;
        const amount = parseInt(giftAmount, 10);
        if (!Number.isFinite(amount) || amount < 1) { show('Введите количество'); return; }
        if (amount > page.gift_balance) { show(`В пуле только ${page.gift_balance} 💧`); return; }
        setBusy(true);
        try {
            const res = await giftDrops(playerId, amount);
            hapticNotification('success');
            show(`💧 Подарено ${res.gifted} капель`);
            setGiftForm(false); setGiftAmount('');
            setPage((p) => (p ? { ...p, gift_balance: res.gift_balance } : p));
        } catch (e) { fail(e, 'Не удалось подарить капли'); }
        finally { setBusy(false); }
    }, [busy, page, giftAmount, playerId, show, fail]);

    if (loading) {
        return (
            <div className="shelf-page-backdrop">
                <div className="shelf-page"><div className="cube-modal-empty">Загрузка…</div></div>
            </div>
        );
    }
    if (!page) {
        return (
            <div className="shelf-page-backdrop" onClick={onClose}>
                <div className="shelf-page" onClick={(e) => e.stopPropagation()}>
                    <div className="cube-modal-empty">Не удалось загрузить</div>
                    <button className="cube-btn-sm" onClick={onClose}>Закрыть</button>
                </div>
            </div>
        );
    }

    const slotsFull = page.slots_used >= page.slots_total;

    return (
        <div className="shelf-page-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="shelf-page" onClick={(e) => e.stopPropagation()}>
                <button className="shelf-page-close" onClick={(e) => { e.stopPropagation(); onClose(); }}>✕</button>

                {toast && <div className="admin-toast">{toast}</div>}

                {/* Шапка: фото крупно + профиль */}
                <div className="shelf-hero">
                    <img className="shelf-hero-photo" src={page.card_photo_url} alt={page.first_name ?? 'Игрок'} />
                    <div className="shelf-hero-name">{page.first_name || 'Игрок'}</div>
                    {page.profile_line && (
                        <div className="shelf-hero-profile">Игрок: {page.profile_line}</div>
                    )}
                </div>

                <div className="shelf-stat-row">
                    <div className="shelf-stat"><span className="shelf-stat-value">{page.xp}</span><span>XP</span></div>
                    <div className="shelf-stat"><span className="shelf-stat-value">🔥 {page.current_streak}</span><span>стрик</span></div>
                    <div className="shelf-stat"><span className="shelf-stat-value">{page.best_streak}</span><span>рекорд</span></div>
                </div>
                <div className="shelf-xp-bar">
                    <div className="shelf-xp-fill" style={{ width: `${Math.min(100, (page.xp % 1000) / 10)}%` }} />
                </div>
                <div className="shelf-xp-hint">
                    До следующей отметки {Math.ceil((page.xp + 1) / 1000) * 1000} XP · последняя тренировка {fmtDate(page.last_workout_date)}
                </div>

                {/* Полка */}
                <div className="shelf-section-head">
                    <span>Полка</span>
                    <span className={`shelf-slots${slotsFull ? ' shelf-slots--full' : ''}`}>
                        {page.slots_used}/{page.slots_total}
                    </span>
                </div>

                {page.shelf.length === 0 ? (
                    <div className="shelf-empty">Полка пуста. Положи обещание или предмет.</div>
                ) : page.shelf.map((it) => (
                    <div key={it.id} className={`shelf-lot${it.status === 'hidden' ? ' shelf-lot--hidden' : ''}`}>
                        <div className="shelf-lot-main">
                            <div className="shelf-lot-title">
                                {it.type === 'promise' ? '🎬 ' : '⭐ '}{it.title}
                            </div>
                            <div className="shelf-lot-meta">
                                {it.price_drops} 💧 · {STATUS_LABEL[it.status] ?? it.status}
                            </div>
                        </div>
                        <div className="shelf-lot-actions">
                            {it.has_video && (
                                <button className="cube-btn-sm" onClick={(e) => { e.stopPropagation(); openVideo(it, 'promise'); }}>▶</button>
                            )}
                            <button className="cube-btn-sm" disabled={busy}
                                onClick={(e) => { e.stopPropagation(); setEditing({ id: it.id, price: String(it.price_drops) }); }}>
                                💧
                            </button>
                            {it.status === 'hidden' && (
                                <button className="cube-btn-sm" disabled={busy}
                                    onClick={(e) => { e.stopPropagation(); republish(it); }}>↻</button>
                            )}
                            <button className="cube-btn-sm" disabled={busy}
                                onClick={(e) => { e.stopPropagation(); removeItem(it); }}>✕</button>
                        </div>
                    </div>
                ))}

                {editing && (
                    <div className="shelf-inline-form">
                        <input className="cube-modal-input" type="number" inputMode="numeric"
                            value={editing.price}
                            onChange={(e) => setEditing({ ...editing, price: e.target.value })} />
                        <span className="shelf-limit-hint">{page.price_limits.min}–{page.price_limits.max} 💧</span>
                        <button className="cube-btn-sm" disabled={busy} onClick={(e) => { e.stopPropagation(); savePrice(); }}>
                            {busy ? '…' : 'Сохранить'}
                        </button>
                        <button className="cube-btn-sm" disabled={busy} onClick={(e) => { e.stopPropagation(); setEditing(null); }}>Отмена</button>
                    </div>
                )}

                <div className="shelf-add-row">
                    <button className="cube-btn-sm" disabled={busy || slotsFull}
                        onClick={(e) => { e.stopPropagation(); hapticImpact('light'); setPromiseForm(true); }}>
                        ➕ Обещание
                    </button>
                    <button className="cube-btn-sm" disabled={busy || slotsFull}
                        onClick={(e) => {
                            e.stopPropagation();
                            hapticImpact('light');
                            const first = page.catalog[0];
                            if (first) { setStarForm({ key: first.key, title: first.title, stars: first.price_stars }); setStarPrice(String(page.price_limits.min)); }
                            else show('Каталог пуст');
                        }}>
                        ⭐ Предмет
                    </button>
                </div>
                {slotsFull && <div className="shelf-empty">Все слоты заняты — убери лот или подними тариф.</div>}

                {/* Форма обещания */}
                {promiseForm && (
                    <div className="shelf-inline-card">
                        <div className="cube-modal-label">Что обещаешь?</div>
                        <input className="cube-modal-input" maxLength={80} placeholder="Например: поход в кино"
                            value={pTitle} onChange={(e) => setPTitle(e.target.value)} />
                        <div className="cube-modal-label">Цена в каплях ({page.price_limits.min}–{page.price_limits.max})</div>
                        <input className="cube-modal-input" type="number" inputMode="numeric"
                            value={pPrice} onChange={(e) => setPPrice(e.target.value)} />
                        <div className="shelf-add-row">
                            <button className="cube-btn-sm" disabled={!promiseValid || busy}
                                onClick={(e) => { e.stopPropagation(); setRecorder(true); }}>
                                🎥 Записать видео
                            </button>
                            <button className="cube-btn-sm" disabled={busy}
                                onClick={(e) => { e.stopPropagation(); setPromiseForm(false); }}>Отмена</button>
                        </div>
                    </div>
                )}

                {/* Форма Stars-предмета */}
                {starForm && (
                    <div className="shelf-inline-card">
                        <div className="cube-modal-label">Предмет из каталога</div>
                        <div className="shelf-catalog-row">
                            {page.catalog.map((c) => (
                                <button key={c.key}
                                    className={`market-player-chip${starForm.key === c.key ? ' active' : ''}`}
                                    onClick={(e) => { e.stopPropagation(); setStarForm({ key: c.key, title: c.title, stars: c.price_stars }); }}>
                                    {c.title} — {c.price_stars} ⭐
                                </button>
                            ))}
                        </div>
                        <div className="cube-modal-label">Цена для игрока в каплях ({page.price_limits.min}–{page.price_limits.max})</div>
                        <input className="cube-modal-input" type="number" inputMode="numeric"
                            value={starPrice} onChange={(e) => setStarPrice(e.target.value)} />
                        <div className="shelf-add-row">
                            <button className="cube-btn-sm" disabled={busy}
                                onClick={(e) => { e.stopPropagation(); buyStarItem(); }}>
                                {busy ? '…' : `Купить за ${starForm.stars} ⭐`}
                            </button>
                            <button className="cube-btn-sm" disabled={busy}
                                onClick={(e) => { e.stopPropagation(); setStarForm(null); }}>Отмена</button>
                        </div>
                    </div>
                )}

                {/* К исполнению */}
                <div className="shelf-section-head">
                    <span>К исполнению</span>
                    {page.pending_count > 0 && <span className="shelf-pending-badge">⏳ {page.pending_count}</span>}
                </div>
                {page.pending.length === 0 ? (
                    <div className="shelf-empty">Долгов нет.</div>
                ) : page.pending.map((it) => (
                    <div key={it.id} className="shelf-lot shelf-lot--pending">
                        <div className="shelf-lot-main">
                            <div className="shelf-lot-title">🎬 {it.title}</div>
                            <div className="shelf-lot-meta">
                                {it.price_drops} 💧 · выкуплено {fmtDate(it.purchased_at)} · галочку ставит игрок
                            </div>
                        </div>
                        {it.has_video && (
                            <div className="shelf-lot-actions">
                                <button className="cube-btn-sm" onClick={(e) => { e.stopPropagation(); openVideo(it, 'promise'); }}>▶</button>
                            </div>
                        )}
                    </div>
                ))}

                {/* Подарить */}
                <div className="shelf-section-head"><span>Подарить</span></div>
                <div className="shelf-gift-row">
                    <span className="shelf-gift-balance">💧 {page.gift_balance} в пуле</span>
                    <button className="cube-btn-sm" disabled={busy}
                        onClick={(e) => { e.stopPropagation(); setPacks(true); }}>Пополнить</button>
                </div>
                <div className="shelf-add-row">
                    <button className="cube-btn-sm" disabled={busy || page.gift_balance < 1}
                        onClick={(e) => { e.stopPropagation(); setGiftForm(true); }}>💧 Подарить капли</button>
                    <button className="cube-btn-sm" disabled={busy || page.gift_freeze_balance < 1}
                        onClick={(e) => { e.stopPropagation(); setFreezeGift(true); }}>
                        ❄️ Подарить заморозку ({page.gift_freeze_balance})
                    </button>
                </div>
                {giftForm && (
                    <div className="shelf-inline-form">
                        <input className="cube-modal-input" type="number" inputMode="numeric"
                            placeholder="сколько капель" value={giftAmount}
                            onChange={(e) => setGiftAmount(e.target.value)} />
                        <button className="cube-btn-sm" disabled={busy} onClick={(e) => { e.stopPropagation(); doGift(); }}>
                            {busy ? '…' : 'Подарить'}
                        </button>
                        <button className="cube-btn-sm" disabled={busy}
                            onClick={(e) => { e.stopPropagation(); setGiftForm(false); }}>Отмена</button>
                    </div>
                )}

                {/* Репутация */}
                <div className="shelf-reputation">
                    🏅 Исполнено обещаний на <b>{page.reputation_drops}</b> 💧
                </div>

                {recorder && (
                    <PromiseRecorder
                        title="Запиши обещание"
                        hint={`«${pTitle.trim()}» — ${pPrice} 💧. До 30 секунд.`}
                        confirmLabel="На полку"
                        busy={busy}
                        error={recError}
                        progress={upProgress}
                        onReady={submitPromise}
                        onCancel={() => { setRecorder(false); setRecError(''); }}
                    />
                )}
                {packs && <DropPackModal onClose={() => setPacks(false)} onCredited={load} />}
                {freezeGift && (
                    <GiftFreezeModal
                        targetUserId={playerId}
                        playerName={page.first_name}
                        onClose={() => setFreezeGift(false)}
                        onSuccess={(m) => { setFreezeGift(false); show(m); load(); }}
                    />
                )}
            </div>
        </div>
    );
};

export default MentorPlayerPage;
