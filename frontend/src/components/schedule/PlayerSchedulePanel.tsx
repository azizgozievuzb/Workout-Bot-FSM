import React, { useEffect, useState, useCallback } from 'react';
import { useAuthStore } from '../../stores/authStore';
import {
    DAY_LABELS, getSchedule, setSchedule, setMorningReminderTime,
    type ScheduleState,
} from '../../api/schedule';
import ScheduleDaysPicker from './ScheduleDaysPicker';
import ConfirmSpendModal from '../shared/ConfirmSpendModal';
import { hapticNotification } from '../../utils/haptic';
import './schedule.css';

interface Props {
    lastClosedDay?: string | null;
    freeFreezes?: number;
    paidFreezes?: number;
    /** Эконом-патч №1: имя + звание игрока — шапка его главного экрана. */
    firstName?: string | null;
    playerTitle?: string | null;
    /** Баланс капель — нужен окну подтверждения траты (П.7). */
    dropsBalance?: number;
}

function todayWeekday(): number {
    // JS getDay(): 0=Вс…6=Сб → наш формат 0=Пн…6=Вс
    return (new Date().getDay() + 6) % 7;
}
function todayISO(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtDate(iso: string): string {
    // 'YYYY-MM-DD' → 'DD.MM'
    const [, m, d] = iso.split('-');
    return d && m ? `${d}.${m}` : iso;
}

const PlayerSchedulePanel: React.FC<Props> = ({
    lastClosedDay, freeFreezes, paidFreezes, firstName, playerTitle, dropsBalance,
}) => {
    const storeMain = useAuthStore((s) => s.mainDays);
    const storeReminder = useAuthStore((s) => s.morningReminderTime);
    const setMainDaysStore = useAuthStore((s) => s.setMainDays);
    const setReminderStore = useAuthStore((s) => s.setMorningReminderTime);

    const [sched, setSched] = useState<ScheduleState | null>(null);
    const [editing, setEditing] = useState(false);
    const [draftDays, setDraftDays] = useState<number[]>([]);
    const [time, setTime] = useState<string>(storeReminder || '08:00');
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');
    /* П.7: смена графика вне grace — необратимая трата, окно обязательно. */
    const [confirmChange, setConfirmChange] = useState(false);

    useEffect(() => {
        getSchedule().then(setSched).catch(() => {});
    }, []);

    const mainDays = sched?.main_days ?? storeMain ?? [];
    const tWd = todayWeekday();
    const tISO = todayISO();
    const lightActive = sched?.light_active ?? false;
    const changePrice = sched?.schedule_change_price ?? null;
    const inGrace = sched?.in_grace ?? false;

    const saveTime = useCallback(async () => {
        setBusy(true); setMsg('');
        try {
            await setMorningReminderTime(time);
            setReminderStore(time);
            hapticNotification('success');
            setMsg('Время сохранено');
        } catch {
            hapticNotification('error');
            setMsg('Ошибка сохранения');
        } finally { setBusy(false); }
    }, [time, setReminderStore]);

    const [cooldownFlash, setCooldownFlash] = useState(false);

    const saveDays = useCallback(async () => {
        if (draftDays.length !== 3) return;
        setBusy(true); setMsg('');
        try {
            const res = await setSchedule(draftDays);
            setSched(res);
            setMainDaysStore(res.main_days ?? draftDays);
            hapticNotification('success');
            setEditing(false);
            if (res.pending_main_days) {
                setMsg(`Новые дни вступят в силу с ${String(res.pending_schedule_from)}`);
            } else {
                setMsg('Расписание обновлено');
            }
        } catch (e: any) {
            hapticNotification('error');
            const detail = e?.response?.data?.detail;
            const code = typeof detail === 'object' ? detail?.code : '';
            if (code === 'SCHEDULE_COOLDOWN') {
                const na = detail?.next_change_available_at;
                setMsg(`Смена доступна с ${na ? new Date(na).toLocaleDateString() : 'позже'}`);
            } else if (code === 'INSUFFICIENT_DROPS') {
                setMsg(`Недостаточно капель: ${detail?.balance ?? 0}/${detail?.price ?? ''} 💧`);
            } else {
                setMsg('Не удалось сменить дни');
            }
        } finally { setBusy(false); setConfirmChange(false); }
    }, [draftDays, setMainDaysStore]);

    /* Бесплатная смена (первичная установка / grace) окном не гейтится: тратить
       там нечего, а лишний шаг мешал бы онбордингу. */
    const paidChange = !inGrace && !!changePrice;
    /* Кулдаун 30 дней (смоук S63): бэк отбивает смену 409 SCHEDULE_COOLDOWN ДО
       списания, но кнопка этого не знала — игрок открывал окно, где обещаны
       «Спишется 100 💧» и «вступят со следующего понедельника», жал «Сменить» и
       получал отказ. Гейтим здесь: серая, но живая, тап называет дату (П.9). */
    const onCooldown = !!sched && !sched.can_change_now;
    const submitDays = useCallback(() => {
        if (draftDays.length !== 3) return;
        if (onCooldown) {
            /* Причину НЕ дублируем в msg: строка cooldownText висит рядом с
               кнопкой постоянно (смоук S63 — две одинаковые фразы на экране).
               Тап отвечает haptic-ом и подсветкой той самой строки. */
            hapticNotification('error');
            setCooldownFlash(true);
            window.setTimeout(() => setCooldownFlash(false), 900);
            return;
        }
        if (paidChange) { setConfirmChange(true); return; }
        void saveDays();
    }, [draftDays.length, onCooldown, paidChange, saveDays]);

    /* Отложенная смена (смоук S63): игрок платил 100 💧 и не видел НИКАКОГО
       следа покупки — дни на экране прежние, новых нигде нет («списали и ничего
       не произошло», класс находки №11 из S59). Транзиентного тоста после
       сохранения мало: он исчезает, а ждать понедельника — дни. Держим строку
       постоянно, пока смена не вступила в силу. */
    const pendingText = sched?.pending_main_days && sched.pending_schedule_from
        ? `С понедельника ${fmtDate(sched.pending_schedule_from)}: `
          + [...sched.pending_main_days].sort((a, b) => a - b)
              .map((d) => DAY_LABELS[d]?.[1] ?? d).join('·')
        : null;

    const cooldownText = sched && !sched.can_change_now && sched.next_change_available_at
        ? `Следующая смена доступна с ${new Date(sched.next_change_available_at).toLocaleDateString()}`
        : sched?.in_grace ? 'Первые 14 дней — смена бесплатно и без ограничений'
            : null;

    return (
        <div className="sched-settings" onClick={(e) => e.stopPropagation()}>
            {/* Эконом-патч №1: имя и звание — шапка главного экрана игрока.
                Звание приезжает с лотом `title` полки наставника. */}
            {(firstName || playerTitle) && (
                <div className="player-identity">
                    <div className="player-identity-name">{firstName || 'Игрок'}</div>
                    {playerTitle && <div className="player-title-line">🏅 {playerTitle}</div>}
                </div>
            )}

            {/* Индикатор недели — в light-режиме main/light-дни разными маркерами */}
            <div>
                <div className="sched-row-label">Твоя неделя</div>
                <div className="week-strip">
                    {DAY_LABELS.map(([wd, label]) => {
                        const isMain = mainDays.includes(wd);
                        const isToday = wd === tWd;
                        const isLightDay = lightActive && !isMain;
                        const isClosed = isToday && (isMain || isLightDay) && lastClosedDay === tISO;
                        const cls = ['week-dot'];
                        if (isMain) cls.push('main');
                        else if (isLightDay) cls.push('light');
                        if (isClosed) cls.push('closed');
                        if (isToday) cls.push('today');
                        return <div key={wd} className={cls.join(' ')}>{label}</div>;
                    })}
                </div>
                {lightActive && (
                    <div className="sched-cooldown">🔵 main-дни · 🟡 light-дни (лёгкая зарядка)</div>
                )}
                {sched?.light_active_from && (
                    <div className="sched-light-caption">Light с понедельника {fmtDate(sched.light_active_from)}</div>
                )}
                {/* Трайал от наставника: у него оба конца — понедельники, поэтому
                    подпись говорит и про старт, и про возврат в main-only. */}
                {sched?.light_trial_active && sched.light_trial_until && (
                    <div className="sched-light-caption">
                        Неделя light от наставника — до понедельника {fmtDate(sched.light_trial_until)}
                    </div>
                )}
                {!sched?.light_trial_active && sched?.light_trial_from && !sched.light_unlocked
                    && sched.light_trial_until && todayISO() < sched.light_trial_from && (
                    <div className="sched-light-caption">
                        Light-трайал с понедельника {fmtDate(sched.light_trial_from)}
                    </div>
                )}
            </div>

            {/* Заморозки */}
            <div className="sched-freeze-badge">
                ❄️ Заморозки: {(freeFreezes ?? 0) + (paidFreezes ?? 0)}
                {/* Не «докупленных»: в этой цифре лежат и подаренные наставником
                    заморозки (смоук S63) — слово врало про происхождение. */}
                <span style={{ opacity: 0.5 }}> (бесплатных {freeFreezes ?? 0}, в запасе {paidFreezes ?? 0})</span>
            </div>

            {/* Утреннее напоминание */}
            <div>
                <div className="sched-row-label">Время утреннего напоминания</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                        type="time"
                        className="sched-time-input"
                        value={time}
                        onChange={(e) => setTime(e.target.value)}
                    />
                    <button className="sched-save-btn" disabled={busy} onClick={saveTime}>Сохранить</button>
                </div>
            </div>

            {/* Смена main-дней */}
            <div>
                <div className="sched-row-label">Дни main-тренировок</div>
                {!editing && (
                    <>
                        <div className="week-strip">
                            {mainDays.map((wd) => (
                                <div key={wd}
                                    className={`week-dot main${
                                        sched?.pending_main_days
                                        && !sched.pending_main_days.includes(wd) ? ' week-dot--leaving' : ''}`}>
                                    {DAY_LABELS[wd]?.[1]}</div>
                            ))}
                        </div>
                        <button
                            className="sched-save-btn"
                            style={{ marginTop: 10 }}
                            onClick={() => { setDraftDays([...mainDays]); setEditing(true); }}
                        >
                            {/* 8c: вне grace смена платная */}
                            {!inGrace && changePrice
                                ? `Сменить за ${changePrice} 💧`
                                : 'Изменить дни main-тренировок'}
                        </button>
                    </>
                )}
                {editing && (
                    <>
                        <ScheduleDaysPicker selected={draftDays} onChange={setDraftDays} disabled={busy} />
                        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                            <button
                                className={`sched-save-btn${onCooldown ? ' sched-save-btn--muted' : ''}`}
                                disabled={busy || draftDays.length !== 3} onClick={submitDays}>
                                Сохранить
                            </button>
                            <button
                                className="sched-save-btn"
                                style={{ background: 'rgba(255,255,255,0.12)' }}
                                disabled={busy}
                                onClick={() => setEditing(false)}
                            >
                                Отмена
                            </button>
                        </div>
                        {/* Баланс на экране траты: без него игрок не знает,
                            хватает ли на смену (смоук S63). */}
                        {paidChange && dropsBalance !== undefined && (
                            <div className="sched-cooldown">У тебя {dropsBalance} 💧</div>
                        )}
                    </>
                )}
                {pendingText && (
                    <div className="sched-cooldown sched-cooldown--pending">📅 {pendingText}</div>
                )}
                {cooldownText && (
                    <div className={`sched-cooldown${cooldownFlash ? ' sched-cooldown--flash' : ''}`}>
                        {cooldownText}
                    </div>
                )}
            </div>

            {/* 8c: покупки light переехали в витрину (MarketCube) */}
            <div>
                <div className="sched-row-label">Light-режим (лёгкая зарядка)</div>
                <div className="sched-cooldown">
                    Light — 4 упражнения-зарядки, стрик становится ежедневным.
                    Открыть или закрыть light-режим можно в магазине: Магазин →
                </div>
            </div>

            {msg && <div className="sched-cooldown">{msg}</div>}

            {confirmChange && changePrice !== null && (
                <ConfirmSpendModal
                    title="📅 Сменить дни тренировок"
                    price={changePrice}
                    balance={dropsBalance ?? 0}
                    note="Новые дни вступят в силу со следующего понедельника."
                    confirmLabel="Сменить"
                    busy={busy}
                    onConfirm={() => { void saveDays(); }}
                    onCancel={() => setConfirmChange(false)}
                />
            )}
        </div>
    );
};

export default PlayerSchedulePanel;
