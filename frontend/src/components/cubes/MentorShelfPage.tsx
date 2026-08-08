import React, { useCallback, useState } from 'react';
import {
    createPromise, createStarItemInvoice, deleteShelfItem, patchShelfItem,
} from '../../api/shelf';
import type { CatalogItem, LotPricing, PlayerPage, ShelfItem } from '../../api/shelf';
import { MAX_TITLE_LEN, TITLE_LOT_KEY } from '../../api/shelf';
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

/* Сколько отчётов показываем сразу. Полка — это МАГАЗИН, а отчёты здесь архив:
   бэк и так отдаёт максимум 10 и чистит их ретеншном через 30 дней, но даже
   десять карточек с видео превращают рабочий экран в простыню (смоук 8d.1).
   Остальные — по тапу. */
const REPORTS_PREVIEW = 3;

function fmtDate(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('ru-RU');
}

type VideoTarget = { itemId: string; kind: 'promise' | 'report'; title: string };

/* S62-2 — выбор цены лота: «кто размещает — тот и ценит». Наставник выбирает
   СМЫСЛ (ступень тяжести), цифру под неё считает бэк от теоретического
   месячного потолка ЭТОГО игрока; пятый вариант — своя цифра в коридоре.

   ⚠️ Инвариант §1: подсказка говорит только про ПОТОЛОК ФОРМУЛ. Фактический
   заработок и баланс игрока наставнику не показываются нигде и никогда. */
const LotPriceChooser: React.FC<{
    pricing: LotPricing;
    /** Ступень, ближайшая к ориентиру каталога (Э.5 живёт рекомендацией). */
    recommended?: string | null;
    /** Верхняя граница: потолок игрока при размещении, текущая цена — при снижении. */
    ceiling: number;
    value: string;
    onChange: (v: string) => void;
    hint?: string;
}> = ({ pricing, recommended, ceiling, value, onChange, hint }) => {
    const [custom, setCustom] = useState(false);
    const num = parseInt(value, 10);
    const matched = pricing.presets.some((p) => p.price === num && p.price <= ceiling);
    const showInput = custom || !matched;
    /* Кнопка «Купить/Снизить» гаснет по этому же условию — молчащая блокировка
       была находкой смоука S63 (урок №3: у запрета всегда видима причина). */
    const badCustom = showInput && !priceInCorridor(value, pricing, ceiling);

    return (
        <>
            <div className="shelf-limit-hint">
                При идеальном месяце твой игрок заработает до {pricing.cap} 💧
            </div>
            <div className="cube-modal-label">Цена для игрока</div>
            <div className="lot-price-grid">
                {pricing.presets.map((p) => (
                    <button key={p.key} type="button"
                        className={`lot-price-step${!showInput && num === p.price ? ' active' : ''}`}
                        disabled={p.price > ceiling}
                        onClick={(e) => { e.stopPropagation(); setCustom(false); onChange(String(p.price)); }}>
                        <span className="lot-price-step-label">{p.label}</span>
                        <span className="lot-price-step-value">{p.price} 💧</span>
                        {recommended === p.key && (
                            <span className="lot-price-step-tag">рекомендуем</span>
                        )}
                    </button>
                ))}
                <button type="button"
                    className={`lot-price-step${showInput ? ' active' : ''}`}
                    onClick={(e) => { e.stopPropagation(); setCustom(true); }}>
                    <span className="lot-price-step-label">Своя цена</span>
                    <span className="lot-price-step-value">{pricing.min}–{ceiling} 💧</span>
                </button>
            </div>
            {showInput && (
                <input
                    className={`cube-modal-input${badCustom ? ' is-invalid' : ''}`}
                    type="number" inputMode="numeric"
                    value={value} onChange={(e) => onChange(e.target.value)} />
            )}
            {badCustom && (
                <div className="shelf-limit-hint shelf-limit-hint--error">
                    от {pricing.min} до {ceiling} 💧
                </div>
            )}
            {hint && <div className="shelf-limit-hint">{hint}</div>}
        </>
    );
};

function priceInCorridor(raw: string, pricing: LotPricing, ceiling: number): boolean {
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= pricing.min && n <= ceiling;
}

const MentorShelfPage: React.FC<Props> = ({ page, reload, onBack, onOpenProfile, show }) => {
    const [busy, setBusy] = useState(false);
    /* `lot` — предмет каталога: цену меняем ступенями/цифрой и только ВНИЗ.
       `promise` — своё обещание: свободный ввод в админ-лимитах, как было. */
    const [editing, setEditing] = useState<
        { id: string; price: string; kind: 'promise' | 'lot'; ceiling: number } | null
    >(null);
    const [video, setVideo] = useState<VideoTarget | null>(null);
    const [nudge, setNudge] = useState<'promise' | 'star' | null>(null);
    const [allReports, setAllReports] = useState(false);

    const [promiseForm, setPromiseForm] = useState(false);
    const [recorder, setRecorder] = useState(false);
    const [recError, setRecError] = useState('');
    const [upProgress, setUpProgress] = useState<number | null>(null);
    const [pTitle, setPTitle] = useState('');
    const [pPrice, setPPrice] = useState('');

    /* S62-2: цену лота назначает наставник — ступенью или своей цифрой. Дефолт
       при открытии формы — рекомендованная ступень (ближайшая к ориентиру Э.5). */
    const [starForm, setStarForm] = useState<CatalogItem | null>(null);
    const [starPrice, setStarPrice] = useState('');
    const [titleText, setTitleText] = useState('');

    const playerId = page.player_id;
    const slotsFull = page.slots_used >= page.slots_total;
    const pricing = page.lot_pricing;

    /* Цена по умолчанию для лота: цифра рекомендованной ступени, а если бэк
       рекомендации не дал — ближайшее к ориентиру каталога внутри коридора. */
    const defaultPriceFor = useCallback((c: CatalogItem): string => {
        const rec = pricing.presets.find((p) => p.key === pricing.recommended[c.key]);
        if (rec) return String(rec.price);
        return String(Math.min(Math.max(c.price_drops, pricing.min), pricing.cap));
    }, [pricing]);

    const fail = useCallback((e: any, fallback: string) => {
        hapticNotification('error');
        const d = e?.response?.data?.detail;
        const code = typeof d === 'object' ? d?.code : '';
        if (code === 'PRICE_OUT_OF_LIMITS') show(`Цена должна быть от ${d.min} до ${d.max} 💧`);
        else if (code === 'PRICE_OUT_OF_CORRIDOR') show(`Цена лота — от ${d.min} до ${d.max} 💧`);
        else if (code === 'PRICE_ONLY_DOWN') show(`Цену можно только снижать: сейчас ${d.current} 💧`);
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
        const text = titleText.trim();
        if (starForm.key === TITLE_LOT_KEY && !text) {
            show('Напиши звание — без текста лот пустой');
            return;
        }
        if (!priceInCorridor(starPrice, pricing, pricing.cap)) {
            show(`Цена лота — от ${pricing.min} до ${pricing.cap} 💧`);
            return;
        }
        setBusy(true);
        try {
            const { payment_id, invoice_link } = await createStarItemInvoice(
                playerId, starForm.key, parseInt(starPrice, 10),
                starForm.key === TITLE_LOT_KEY ? text : undefined,
            );
            const opened = openStarInvoice(invoice_link, async (status) => {
                if (status === 'paid') {
                    show('Оплата получена, выставляем на полку…');
                    const res = await pollPayment(payment_id);
                    if (res === 'fulfilled') { hapticNotification('success'); show('🎁 Предмет на полке'); reload(); }
                    else show(res === 'timeout' ? 'Оплата обрабатывается — предмет появится сам' : 'Не удалось выставить предмет');
                } else {
                    show(status === 'cancelled' ? 'Покупка отменена' : 'Оплата не прошла');
                }
                setBusy(false); setStarForm(null); setStarPrice(''); setTitleText('');
            });
            if (!opened) { show('Оплата недоступна в этом клиенте'); setBusy(false); }
        } catch (e) { fail(e, 'Не удалось создать счёт'); setBusy(false); }
    }, [starForm, starPrice, pricing, titleText, busy, playerId, show, fail, reload]);

    /* ---------- Лоты ---------- */
    const savePrice = useCallback(async () => {
        if (!editing || busy) return;
        const price = parseInt(editing.price, 10);
        /* Лот: коридор и «только вниз» держит RPC, но отказ должен быть виден
           ДО запроса — иначе кнопка выглядит мёртвой (урок №3). */
        if (editing.kind === 'lot' && !priceInCorridor(editing.price, pricing, editing.ceiling)) {
            show(`Цену можно поставить от ${pricing.min} до ${editing.ceiling} 💧 — только ниже текущей`);
            return;
        }
        setBusy(true);
        try {
            await patchShelfItem(editing.id, { price_drops: price });
            hapticNotification('success');
            setEditing(null);
            reload();
        } catch (e) { fail(e, 'Не удалось изменить цену'); }
        finally { setBusy(false); }
    }, [editing, busy, pricing, show, fail, reload]);

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

    /* Отказ по слотам обязан ВЫГЛЯДЕТЬ как нажатие, иначе серая кнопка читается
       как мёртвая (смоук 8d.1). Класс снимаем по таймеру — повторный тап должен
       проигрывать анимацию заново. */
    const bounce = useCallback((which: 'promise' | 'star') => {
        setNudge(which);
        setTimeout(() => setNudge((n) => (n === which ? null : n)), 300);
    }, []);

    const addPromise = useCallback(() => {
        if (slotsFull) { hapticNotification('warning'); bounce('promise'); show(SLOTS_FULL_TOAST); return; }
        hapticImpact('light'); setPromiseForm(true);
    }, [slotsFull, show, bounce]);

    const addStarItem = useCallback(() => {
        if (slotsFull) { hapticNotification('warning'); bounce('star'); show(SLOTS_FULL_TOAST); return; }
        hapticImpact('light');
        const first = page.catalog[0];
        if (!first) { show('Каталог пуст'); return; }
        setStarForm(first);
        setStarPrice(defaultPriceFor(first));
        setTitleText('');
    }, [slotsFull, page.catalog, show, bounce, defaultPriceFor]);

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

            {/* Репутация (Д3, S62-3.3) — единая метрика вклада наставника: она
                поощряет и исполнение обещаний, и наполнение полки. Засчёт по
                принципу «игрок ПОЛУЧИЛ ценность»: обещание — по галочке, лот —
                по выкупу. Невыполненное сюда не входит, оно давит бейджем «⏳». */}
            <div className="mentor-reputation">
                🏅 Репутация: <b>{page.reputation_drops}</b> 💧
                <span className="mentor-reputation-hint">
                    исполненные обещания и выкупленные подарки — {page.reputation_count} шт.
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
                                }}>▶︎ Смотреть</button>
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
                    {(allReports ? page.reports : page.reports.slice(0, REPORTS_PREVIEW)).map((it) => (
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
                                    }}>▶︎ Смотреть отчёт</button>
                                    {it.has_video && (
                                        <button className="cube-btn-sm" onClick={(e) => {
                                            e.stopPropagation();
                                            setVideo({ itemId: it.id, kind: 'promise', title: `Обещание «${it.title}»` });
                                        }}>▶︎ Обещание</button>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                    {page.reports.length > REPORTS_PREVIEW && (
                        <button className="mentor-more-link"
                            onClick={(e) => { e.stopPropagation(); setAllReports((v) => !v); }}>
                            {allReports
                                ? 'Свернуть'
                                : `Показать все (${page.reports.length}) →`}
                        </button>
                    )}
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
                                }}>▶︎ Смотреть</button>
                            </div>
                        )}
                    </div>
                    <div className="shelf-lot-actions">
                        {/* Цену правим у обоих типов, но по-разному: у обещания —
                            свободный ввод, у лота каталога — ступени и ТОЛЬКО вниз
                            (S62-2: игрок, копящий на цену, не должен увидеть её
                            выросшей). Гейт держит RPC, здесь только форма. */}
                        <button className="cube-btn-sm" disabled={busy}
                            title={it.type === 'promise' ? 'Сменить цену' : 'Снизить цену'}
                            onClick={(e) => {
                                e.stopPropagation();
                                setEditing({
                                    id: it.id,
                                    price: String(it.price_drops),
                                    kind: it.type === 'promise' ? 'promise' : 'lot',
                                    ceiling: it.price_drops,
                                });
                            }}>
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

            {editing && editing.kind === 'promise' && (
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

            {editing && editing.kind === 'lot' && (
                <div className="mentor-inline-card">
                    <LotPriceChooser
                        key={editing.id}
                        pricing={pricing}
                        ceiling={editing.ceiling}
                        value={editing.price}
                        onChange={(v) => setEditing({ ...editing, price: v })}
                        hint={`Лот залежался — снижай. Поднять цену нельзя: сейчас ${editing.ceiling} 💧`}
                    />
                    <div className="mentor-btn-row">
                        <button className="cube-btn-sm"
                            disabled={busy || !priceInCorridor(editing.price, pricing, editing.ceiling)}
                            onClick={(e) => { e.stopPropagation(); savePrice(); }}>
                            {busy ? '…' : 'Снизить цену'}
                        </button>
                        <button className="cube-btn-sm" disabled={busy}
                            onClick={(e) => { e.stopPropagation(); setEditing(null); }}>Отмена</button>
                    </div>
                </div>
            )}

            {/* П.9: кнопки при полной полке серые, но живые — тап объясняет причину. */}
            <div className="mentor-btn-row">
                <button
                    className={`cube-btn-sm${slotsFull ? ' cube-btn-sm--muted' : ''}${nudge === 'promise' ? ' cube-btn-sm--nudge' : ''}`}
                    disabled={busy}
                    onClick={(e) => { e.stopPropagation(); addPromise(); }}>
                    ➕ Обещание
                </button>
                <button
                    className={`cube-btn-sm${slotsFull ? ' cube-btn-sm--muted' : ''}${nudge === 'star' ? ' cube-btn-sm--nudge' : ''}`}
                    disabled={busy}
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
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setStarForm(c); setStarPrice(defaultPriceFor(c)); setTitleText('');
                                }}>
                                {c.title} — {c.price_stars} ⭐
                            </button>
                        ))}
                    </div>
                    <LotPriceChooser
                        key={starForm.key}
                        pricing={pricing}
                        recommended={pricing.recommended[starForm.key]}
                        ceiling={pricing.cap}
                        value={starPrice}
                        onChange={setStarPrice}
                    />
                    {starForm.key === TITLE_LOT_KEY && (
                        <>
                            <div className="cube-modal-label">
                                Звание для игрока (до {MAX_TITLE_LEN} символов)
                            </div>
                            <input className="cube-modal-input" maxLength={MAX_TITLE_LEN}
                                placeholder="Например: Железная воля"
                                value={titleText}
                                onChange={(e) => setTitleText(e.target.value.slice(0, MAX_TITLE_LEN))} />
                            <div className="shelf-limit-hint">
                                {titleText.trim().length}/{MAX_TITLE_LEN} · заменит текущее звание игрока
                            </div>
                        </>
                    )}
                    <div className="mentor-btn-row">
                        <button className="cube-btn-sm"
                            disabled={busy
                                || (starForm.key === TITLE_LOT_KEY && !titleText.trim())
                                || !priceInCorridor(starPrice, pricing, pricing.cap)}
                            onClick={(e) => { e.stopPropagation(); buyStarItem(); }}>
                            {busy ? '…' : `Купить за ${starForm.price_stars} ⭐`}
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
