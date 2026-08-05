import React, { useCallback, useState } from 'react';
import { giftDrops } from '../../api/shelf';
import type { PlayerPage } from '../../api/shelf';
import { hapticImpact, hapticNotification } from '../../utils/haptic';
import DropPackModal from './DropPackModal';
import GiftFreezeModal from './GiftFreezeModal';

/* 8d.1 — Action (R): страница НАБЛЮДЕНИЯ (П.1a, П.2, П.3).

   Только наблюдение и взаимодействие: досье игрока, дарение, дверь на полку.
   Управления полкой здесь НЕТ — оно целиком переехало в Market (П.1a).
   Баланс капель игрока наставнику по-прежнему не показывается (§8.7). */

interface Props {
    page: PlayerPage;
    setPage: React.Dispatch<React.SetStateAction<PlayerPage | null>>;
    reload: () => void;
    onBack: () => void;
    onOpenShelf: () => void;
    show: (message: string) => void;
}

/* П.3b: наставники — взрослые не-геймеры, каждый термин объясняем прямо на плитке.
   8d.1a (Д3): третья плитка — «последняя тренировка» вместо «рекорда». Исторический
   лучший стрик наставнику не помогает: он не говорит, что делать сегодня. */
const TILES: { key: 'xp' | 'streak' | 'last'; term: string; hint: string }[] = [
    { key: 'xp', term: 'XP', hint: 'очки опыта' },
    { key: 'streak', term: 'стрик', hint: 'дней подряд' },
    { key: 'last', term: 'тренировка', hint: 'когда была последняя' },
];

/** Дни считает бэк в поясе игрока — здесь только подпись. */
function fmtLastWorkout(daysAgo: number | null): string {
    if (daysAgo === null) return '—';
    if (daysAgo === 0) return 'сегодня';
    if (daysAgo === 1) return 'вчера';
    return `${daysAgo} дн`;
}

const MentorPlayerProfile: React.FC<Props> = ({
    page, setPage, reload, onBack, onOpenShelf, show,
}) => {
    const [busy, setBusy] = useState(false);
    const [giftForm, setGiftForm] = useState(false);
    const [giftAmount, setGiftAmount] = useState('');
    const [packs, setPacks] = useState(false);
    const [freezeGift, setFreezeGift] = useState(false);

    const playerId = page.player_id;
    const slotsFull = page.slots_used >= page.slots_total;

    const doGift = useCallback(async () => {
        if (busy) return;
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
        } catch (e: any) {
            hapticNotification('error');
            const d = e?.response?.data?.detail;
            const code = typeof d === 'object' ? d?.code : '';
            show(code === 'INSUFFICIENT_GIFT_BALANCE'
                ? `В пуле только ${d.gift_balance} 💧 — пополните`
                : 'Не удалось подарить капли');
        } finally { setBusy(false); }
    }, [busy, giftAmount, page.gift_balance, playerId, setPage, show]);

    const tileValue = (key: 'xp' | 'streak' | 'last'): string => (
        key === 'xp' ? String(page.xp)
            : key === 'streak' ? String(page.current_streak)
                : fmtLastWorkout(page.last_workout_days_ago)
    );

    return (
        <div className="mentor-page-inner">
            <div className="mentor-page-bar">
                <button className="mentor-back" onClick={(e) => { e.stopPropagation(); onBack(); }}>
                    ← Назад
                </button>
                <span className="mentor-page-heading">Игрок</span>
            </div>

            {/* Досье (П.3a): фото квадратом слева, справа имя и чипы столбиком.
                Столбик не ломается о длинные слова вроде «выносливость». */}
            <div className="mentor-dossier">
                <img className="mentor-dossier-photo" src={page.card_photo_url}
                    alt={page.first_name ?? 'Игрок'} />
                <div className="mentor-dossier-side">
                    <div className="mentor-dossier-name">{page.first_name || 'Игрок'}</div>
                    {page.profile_chips.map((c) => (
                        <div key={c.label}
                            className={`mentor-chip${c.tone === 'warn' ? ' mentor-chip--warn' : ''}`}>
                            <span className="mentor-chip-icon">{c.icon}</span>
                            <span className="mentor-chip-label">{c.label}:</span>
                            <span className="mentor-chip-value">{c.value}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Три плитки с расшифровками (П.3b). XP-прогресс-бар удалён (Д4):
                системы уровней в игре нет, шкала «до кратного 1000» была выдуманной. */}
            <div className="mentor-tiles">
                {TILES.map((t) => (
                    <div key={t.key} className="mentor-tile">
                        <div className="mentor-tile-value">
                            {t.key === 'streak' ? '🔥 ' : ''}{tileValue(t.key)}
                        </div>
                        <div className="mentor-tile-term">{t.term}</div>
                        <div className="mentor-tile-hint">{t.hint}</div>
                    </div>
                ))}
            </div>

            {/* Дарение. Остаток пула виден прямо здесь + шорткат «Пополнить» (Д2):
                иначе пустой пул превращался в тупик — кнопка есть, подарить нечем. */}
            <div className="mentor-section-title">Подарить</div>
            <div className="mentor-gift-box">
                <div className="mentor-gift-head">
                    <span className="mentor-gift-balance">Доступно: {page.gift_balance} 💧</span>
                    <button className="cube-btn-sm" disabled={busy}
                        onClick={(e) => { e.stopPropagation(); hapticImpact('light'); setPacks(true); }}>
                        Пополнить
                    </button>
                </div>
                <div className="mentor-gift-hint">
                    Капли — внутренняя валюта игрока: он тратит их в магазине и на твоей полке.
                </div>

                {giftForm ? (
                    <div className="mentor-inline-form">
                        <input className="cube-modal-input" type="number" inputMode="numeric"
                            placeholder="сколько капель" value={giftAmount}
                            onChange={(e) => setGiftAmount(e.target.value)} />
                        <button className="cube-btn-sm" disabled={busy}
                            onClick={(e) => { e.stopPropagation(); doGift(); }}>
                            {busy ? 'Дарим…' : 'Подарить'}
                        </button>
                        <button className="cube-btn-sm" disabled={busy}
                            onClick={(e) => { e.stopPropagation(); setGiftForm(false); }}>Отмена</button>
                    </div>
                ) : (
                    <div className="mentor-btn-row">
                        <button className="cube-btn-sm" disabled={busy}
                            onClick={(e) => {
                                e.stopPropagation();
                                if (page.gift_balance < 1) { show('Пул пуст — сначала пополни его'); return; }
                                hapticImpact('light'); setGiftForm(true);
                            }}>
                            💧 Подарить капли
                        </button>
                        <button className="cube-btn-sm" disabled={busy}
                            onClick={(e) => {
                                e.stopPropagation();
                                if (page.gift_freeze_balance < 1) { show('Заморозок в запасе нет'); return; }
                                hapticImpact('light'); setFreezeGift(true);
                            }}>
                            ❄️ Заморозка ({page.gift_freeze_balance})
                        </button>
                    </div>
                )}
            </div>

            {/* Дверь на полку (П.1b). При полноте краснеет, но остаётся кликабельной
                (П.9): наставнику как раз и нужно зайти, чтобы освободить слот. */}
            <button
                className={`mentor-door${slotsFull ? ' mentor-door--full' : ''}`}
                onClick={(e) => { e.stopPropagation(); hapticImpact('light'); onOpenShelf(); }}
            >
                <span>🎁 Полка {page.slots_used}/{page.slots_total}</span>
                <span className="mentor-door-arrow">→</span>
            </button>

            {packs && <DropPackModal onClose={() => setPacks(false)} onCredited={reload} />}
            {freezeGift && (
                <GiftFreezeModal
                    targetUserId={playerId}
                    playerName={page.first_name}
                    onClose={() => setFreezeGift(false)}
                    onSuccess={(m) => { setFreezeGift(false); show(m); reload(); }}
                />
            )}
        </div>
    );
};

export default MentorPlayerProfile;
