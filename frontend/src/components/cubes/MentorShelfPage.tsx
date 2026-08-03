import React, { useCallback, useState } from 'react';
import {
    createPromise, createStarItemInvoice, deleteShelfItem, patchShelfItem,
} from '../../api/shelf';
import type { PlayerPage, ShelfItem } from '../../api/shelf';
import { openStarInvoice, pollPayment } from '../../utils/starPayment';
import { hapticImpact, hapticNotification } from '../../utils/haptic';
import PromiseRecorder from './PromiseRecorder';
import VideoPlayerModal from './VideoPlayerModal';

/* 8d.1 — Market (R): ПОЛКА игрока (П.1a, П.1c, П.2, П.9).

   Магазин наставника: лоты, слоты, цены, рекордер обещаний и «⏳ Ждут исполнения»
   (Д1 — блок переехал сюда из Action целиком, одна роль на куб). Живых цифр
   наблюдения (стрик/XP) в шапке НЕТ — они живут в профиле, до него один тап. */

interface Props {
    page: PlayerPage;
    reload: () => void;
    onBack: () => void;
    onOpenProfile: () => void;
    show: (message: string) => void;
}

const STATUS_LABEL: Record<string, string> = {
    active: 'на полке',
    hidden: 'скрыт игроком',
    purchased: 'ждёт исполнения',
};

/* П.9: постоянной строки «Все слоты заняты» больше нет — вместо неё красный
   счётчик в шапке, серые кнопки и вот этот тост по тапу. */
const SLOTS_FULL_TOAST = 'Все слоты полки заняты. Убери лот или дождись, пока игрок его выкупит.';

function fmtDate(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('ru-RU');
}

type VideoTarget = { itemId: string; kind: 'promise' | 'report'; title: string };

const MentorShelfPage: React.FC<Props> = ({ page, reload, onBack, onOpenProfile, show }) => {
    const [busy, setBusy] = useState(false);
    const [editing, setEditing] = useState<{ id: string; price: string } | null>(null);
    const [video, setVideo] = useState<VideoTarget | null>(null);

    const [promiseForm, setPromiseForm] = useState(false);
    const [recorder, setRecorder] = useState(false);
    const [recError, setRecError] = useState('');
    const [upProgress, setUpProgress] = useState<number | null>(null);
    const [pTitle, setPTitle] = useState('');
    const [pPrice, setPPrice] = useState('');

    const [starForm, setStarForm] = useState<{ key: string; title: string; stars: number } | null>(null);
    const [starPrice, setStarPrice] = useState('');

    const playerId = page.player_id;
    const slotsFull = page.slots_used >= page.slots_total;

    const fail = useCallback((e: any, fallback: string) => {
        hapticNotification('error');
        const d = e?.response?.data?.detail;
        const code = typeof d === 'object' ? d?.code : '';
        if (code === 'PRICE_OUT_OF_LIMITS') show(`Цена должна быть от ${d.min} до ${d.max} 💧`);
        else if (code === 'NO_FREE_SLOT') show(`Свободных слотов нет (${d.used}/${d.total})`);
        else if (code === 'SUBSCRIPTION_INACTIVE') show('Подписка неактивна — продлите её');
        else show(fallback);
    }, [show]);

    /* ---------- Обещание ---------- */
    const submitPromise = useCallback(async (blob: Blob) => {
        const price = parseInt(pPrice, 10);
        setBusy(true); setRecError(''); setUpProgress(0);
        try {
            await createPromise({
                playerId, title: pTitle.trim(), priceDrops: price, video: blob,
                onProgress: setUpProgress,
            });
            hapticNotification('success');
            show('🎁 Обещание на полке');
            setRecorder(false); setPromiseForm(false); setPTitle(''); setPPrice('');
            reload();
        } catch (e: any) {
            // Экран записи НЕ закрываем — причина показывается прямо в нём,
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
    }, [playerId, pTitle, pPrice, show, reload]);

    const promiseValid = (() => {
        const price = parseInt(pPrice, 10);
        return pTitle.trim().length >= 2
            && Number.isFinite(price)
            && price >= page.price_limits.min && price <= page.price_limits.max;
    })();

    /* ---------- Stars-предмет ---------- */
    const buyStarItem = useCallback(async () => {
        if (!starForm || busy) return;
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
                    if (res === 'fulfilled') { hapticNotification('success'); show('🎁 Предмет на полке'); reload(); }
                    else show(res === 'timeout' ? 'Оплата обрабатывается — предмет появится сам' : 'Не удалось выставить предмет');
                } else {
                    show(status === 'cancelled' ? 'Покупка отменена' : 'Оплата не прошла');
                }
                setBusy(false); setStarForm(null); setStarPrice('');
            });
            if (!opened) { show('Оплата недоступна в этом клиенте'); setBusy(false); }
        } catch (e) { fail(e, 'Не удалось создать счёт'); setBusy(false); }
    }, [starForm, starPrice, page.price_limits, busy, playerId, show, fail, reload]);

    /* ---------- Лоты ---------- */
    const savePrice = useCallback(async () => {
        if (!editing || busy) return;
        const price = parseInt(editing.price, 10);
        setBusy(true);
        try {
            await patchShelfItem(editing.id, { price_drops: price });
            hapticNotification('success');
            setEditing(null);
            reload();
        } catch (e) { fail(e, 'Не удалось изменить цену'); }
        finally { setBusy(false); }
    }, [editing, busy, fail, reload]);

    const republish = useCallback(async (item: ShelfItem) => {
        if (busy) return;
        setBusy(true);
        try {
            await patchShelfItem(item.id, { status: 'active' });
            hapticNotification('success');
            show('Лот снова на полке');
            reload();
        } catch (e) { fail(e, 'Не удалось перевыставить'); }
        finally { setBusy(false); }
    }, [busy, show, fail, reload]);

    const removeItem = useCallback(async (item: ShelfItem) => {
        if (busy) return;
        setBusy(true);
        try {
            await deleteShelfItem(item.id);
            show('Лот убран с полки');
            reload();
        } catch (e) { fail(e, 'Не удалось убрать лот'); }
        finally { setBusy(false); }
    }, [busy, show, fail, reload]);

    const addPromise = useCallback(() => {
        if (slotsFull) { hapticNotification('warning'); show(SLOTS_FULL_TOAST); return; }
        hapticImpact('light'); setPromiseForm(true);
    }, [slotsFull, show]);

    const addStarItem = useCallback(() => {
        if (slotsFull) { hapticNotification('warning'); show(SLOTS_FULL_TOAST); return; }
        hapticImpact('light');
        const first = page.catalog[0];
        if (!first) { show('Каталог пуст'); return; }
        setStarForm({ key: first.key, title: first.title, stars: first.price_stars });
        setStarPrice(String(page.price_limits.min));
    }, [slotsFull, page.catalog, page.price_limits.min, show]);

    return (
        <div className="mentor-page-inner">
            <div className="mentor-page-bar">
                <button className="mentor-back" onClick={(e) => { e.stopPropagation(); onBack(); }}>
                    ← Назад
                </button>
                <span className="mentor-page-heading">Полка игрока</span>
            </div>

            {/* Шапка-минимум (П.1c): кто, сколько слотов и дверь в профиль. */}
            <div className="mentor-shelf-head">
                <img className="mentor-shelf-photo" src={page.card_photo_url}
                    alt={page.first_name ?? 'Игрок'} />
                <div className="mentor-shelf-head-main">
                    <div className="mentor-shelf-name">{page.first_name || 'Игрок'}</div>
                    <button className="mentor-shelf-profile-link"
                        onClick={(e) => { e.stopPropagation(); hapticImpact('light'); onOpenProfile(); }}>
                        👤 К профилю →
                    </button>
                </div>
                <div className={`mentor-slots${slotsFull ? ' mentor-slots--full' : ''}`}>
                    <span className="mentor-slots-value">{page.slots_used}/{page.slots_total}</span>
                    <span className="mentor-slots-label">слоты</span>
                </div>
            </div>

            {/* Репутация (Д3) — метрика обещаний, поэтому живёт на полке, не в профиле. */}
            <div className="mentor-reputation">
                🏅 Исполнено обещаний: <b>{page.reputation_count}</b>
                <span className="mentor-reputation-hint">
                    обещаний, которые игрок выкупил, а ты выполнил — на {page.reputation_drops} 💧
                </span>
            </div>

            {/* Ждут исполнения (Д1) */}
            <div className="mentor-section-title">
                <span>⏳ Ждут исполнения</span>
                {page.pending_count > 0 && <span className="shelf-pending-badge">⏳ {page.pending_count}</span>}
            </div>
            {page.pending.length === 0 ? (
                <div className="mentor-empty">Долгов нет</div>
            ) : page.pending.map((it) => (
                <div key={it.id} className="shelf-lot shelf-lot--pending">
                    <div className="shelf-lot-main">
                        <div className="shelf-lot-title">🎬 {it.title}</div>
                        <div className="shelf-lot-meta">
                            {it.price_drops} 💧 · выкуплено {fmtDate(it.purchased_at)} · галочку ставит игрок
                        </div>
                        {it.has_video && (
                            <div className="mentor-mini-row">
                                <button className="cube-btn-sm" onClick={(e) => {
                                    e.stopPropagation();
                                    setVideo({ itemId: it.id, kind: 'promise', title: `Обещание «${it.title}»` });
                                }}>▶ Смотреть</button>
                            </div>
                        )}
                    </div>
                </div>
            ))}

            {/* Видеоотчёты игрока (П.6a). В 8d наставник узнавал об отчёте только
                из уведомления и посмотреть его было негде. Файлы чистит ретеншн
                через 30 дней после исполнения — строки исчезают сами. */}
            {page.reports.length > 0 && (
                <>
                    <div className="mentor-section-title"><span>🎥 Отчёты игрока</span></div>
                    {page.reports.map((it) => (
                        <div key={it.id} className="shelf-lot">
                            <div className="shelf-lot-main">
                                <div className="shelf-lot-title">🎬 {it.title}</div>
                                <div className="shelf-lot-meta">
                                    исполнено {fmtDate(it.fulfilled_at)} · игрок снял видеоотчёт
                                </div>
                                <div className="mentor-mini-row">
                                    <button className="cube-btn-sm" onClick={(e) => {
                                        e.stopPropagation();
                                        setVideo({ itemId: it.id, kind: 'report', title: `Отчёт «${it.title}»` });
                                    }}>▶ Смотреть отчёт</button>
                                    {it.has_video && (
                                        <button className="cube-btn-sm" onClick={(e) => {
                                            e.stopPropagation();
                                            setVideo({ itemId: it.id, kind: 'promise', title: `Обещание «${it.title}»` });
                                        }}>▶ Обещание</button>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </>
            )}

            {/* Лоты полки */}
            <div className="mentor-section-title"><span>🎁 На полке</span></div>
            {page.shelf.length === 0 ? (
                <div className="mentor-empty">Полка пуста. Положи обещание или предмет.</div>
            ) : page.shelf.map((it) => (
                <div key={it.id} className={`shelf-lot${it.status === 'hidden' ? ' shelf-lot--hidden' : ''}`}>
                    <div className="shelf-lot-main">
                        <div className="shelf-lot-title">
                            {it.type === 'promise' ? '🎬 ' : '⭐ '}{it.title}
                        </div>
                        <div className="shelf-lot-meta">
                            {it.price_drops} 💧 · {STATUS_LABEL[it.status] ?? it.status}
                        </div>
                        {it.has_video && (
                            <div className="mentor-mini-row">
                                <button className="cube-btn-sm" onClick={(e) => {
                                    e.stopPropagation();
                                    setVideo({ itemId: it.id, kind: 'promise', title: `Обещание «${it.title}»` });
                                }}>▶ Смотреть</button>
                            </div>
                        )}
                    </div>
                    <div className="shelf-lot-actions">
                        <button className="cube-btn-sm" disabled={busy} title="Сменить цену"
                            onClick={(e) => { e.stopPropagation(); setEditing({ id: it.id, price: String(it.price_drops) }); }}>
                            💧
                        </button>
                        {it.status === 'hidden' && (
                            <button className="cube-btn-sm" disabled={busy} title="Перевыставить"
                                onClick={(e) => { e.stopPropagation(); republish(it); }}>↻</button>
                        )}
                        <button className="cube-btn-sm" disabled={busy} title="Убрать с полки"
                            onClick={(e) => { e.stopPropagation(); removeItem(it); }}>✕</button>
                    </div>
                </div>
            ))}

            {editing && (
                <div className="mentor-inline-form">
                    <input className="cube-modal-input" type="number" inputMode="numeric"
                        value={editing.price}
                        onChange={(e) => setEditing({ ...editing, price: e.target.value })} />
                    <span className="shelf-limit-hint">{page.price_limits.min}–{page.price_limits.max} 💧</span>
                    <button className="cube-btn-sm" disabled={busy}
                        onClick={(e) => { e.stopPropagation(); savePrice(); }}>
                        {busy ? '…' : 'Сохранить'}
                    </button>
                    <button className="cube-btn-sm" disabled={busy}
                        onClick={(e) => { e.stopPropagation(); setEditing(null); }}>Отмена</button>
                </div>
            )}

            {/* П.9: кнопки при полной полке серые, но живые — тап объясняет причину. */}
            <div className="mentor-btn-row">
                <button className={`cube-btn-sm${slotsFull ? ' cube-btn-sm--muted' : ''}`} disabled={busy}
                    onClick={(e) => { e.stopPropagation(); addPromise(); }}>
                    ➕ Обещание
                </button>
                <button className={`cube-btn-sm${slotsFull ? ' cube-btn-sm--muted' : ''}`} disabled={busy}
                    onClick={(e) => { e.stopPropagation(); addStarItem(); }}>
                    ⭐ Предмет
                </button>
            </div>

            {promiseForm && (
                <div className="mentor-inline-card">
                    <div className="cube-modal-label">Что обещаешь?</div>
                    <input className="cube-modal-input" maxLength={80} placeholder="Например: поход в кино"
                        value={pTitle} onChange={(e) => setPTitle(e.target.value)} />
                    <div className="cube-modal-label">
                        Цена в каплях ({page.price_limits.min}–{page.price_limits.max})
                    </div>
                    <input className="cube-modal-input" type="number" inputMode="numeric"
                        value={pPrice} onChange={(e) => setPPrice(e.target.value)} />
                    <div className="mentor-btn-row">
                        <button className="cube-btn-sm" disabled={!promiseValid || busy}
                            onClick={(e) => { e.stopPropagation(); setRecorder(true); }}>
                            🎥 Записать видео
                        </button>
                        <button className="cube-btn-sm" disabled={busy}
                            onClick={(e) => { e.stopPropagation(); setPromiseForm(false); }}>Отмена</button>
                    </div>
                </div>
            )}

            {starForm && (
                <div className="mentor-inline-card">
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
                    <div className="cube-modal-label">
                        Цена для игрока в каплях ({page.price_limits.min}–{page.price_limits.max})
                    </div>
                    <input className="cube-modal-input" type="number" inputMode="numeric"
                        value={starPrice} onChange={(e) => setStarPrice(e.target.value)} />
                    <div className="mentor-btn-row">
                        <button className="cube-btn-sm" disabled={busy}
                            onClick={(e) => { e.stopPropagation(); buyStarItem(); }}>
                            {busy ? '…' : `Купить за ${starForm.stars} ⭐`}
                        </button>
                        <button className="cube-btn-sm" disabled={busy}
                            onClick={(e) => { e.stopPropagation(); setStarForm(null); }}>Отмена</button>
                    </div>
                </div>
            )}

            {recorder && (
                <PromiseRecorder
                    title="Запиши обещание"
                    hint={`«${pTitle.trim()}» — ${pPrice} 💧.`}
                    confirmLabel="На полку"
                    busy={busy}
                    error={recError}
                    progress={upProgress}
                    onReady={submitPromise}
                    onCancel={() => { setRecorder(false); setRecError(''); }}
                />
            )}

            {video && (
                <VideoPlayerModal
                    itemId={video.itemId} kind={video.kind} title={video.title}
                    onClose={() => setVideo(null)} onError={show}
                />
            )}
        </div>
    );
};

export default MentorShelfPage;
