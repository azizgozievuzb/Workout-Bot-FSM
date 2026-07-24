import React, { useEffect, useState, useCallback } from 'react';
import { useAuthStore } from '../../stores/authStore';
import {
    DAY_LABELS, getSchedule, setSchedule, setMorningReminderTime,
    unlockLight, lockLight,
    type ScheduleState,
} from '../../api/schedule';
import ScheduleDaysPicker from './ScheduleDaysPicker';
import DisclaimerTest, { UNLOCK_QUESTIONS, LOCK_QUESTIONS } from './DisclaimerTest';
import { hapticNotification } from '../../utils/haptic';
import './schedule.css';

interface Props {
    lastClosedDay?: string | null;
    freeFreezes?: number;
    paidFreezes?: number;
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

const PlayerSchedulePanel: React.FC<Props> = ({ lastClosedDay, freeFreezes, paidFreezes }) => {
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
    const [test, setTest] = useState<'unlock' | 'lock' | null>(null);

    useEffect(() => {
        getSchedule().then(setSched).catch(() => {});
    }, []);

    const doUnlock = useCallback(async () => {
        setTest(null); setBusy(true); setMsg('');
        try {
            const res = await unlockLight();
            setSched(res);
            hapticNotification('success');
            setMsg(res.light_active_from
                ? `Light откроется с понедельника ${fmtDate(res.light_active_from)}`
                : 'Light-режим открыт');
        } catch (e: any) {
            hapticNotification('error');
            const code = e?.response?.data?.detail?.code;
            setMsg(code === 'INSUFFICIENT_DROPS' ? 'Недостаточно капель' : 'Не удалось открыть light');
        } finally { setBusy(false); }
    }, []);

    const doLock = useCallback(async () => {
        setTest(null); setBusy(true); setMsg('');
        try {
            const res = await lockLight();
            setSched(res);
            hapticNotification('success');
            setMsg('Light-режим закроется со следующего понедельника');
        } catch (e: any) {
            hapticNotification('error');
            const code = e?.response?.data?.detail?.code;
            setMsg(code === 'INSUFFICIENT_DROPS' ? 'Недостаточно капель' : 'Не удалось закрыть light');
        } finally { setBusy(false); }
    }, []);

    const mainDays = sched?.main_days ?? storeMain ?? [];
    const tWd = todayWeekday();
    const tISO = todayISO();
    const lightActive = sched?.light_active ?? false;
    const lightUnlocked = sched?.light_unlocked ?? false;
    const unlockPrice = sched?.light_unlock_price ?? 300;
    const lockPrice = sched?.light_lock_price ?? 500;

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
            const code = e?.response?.data?.detail?.code;
            if (code === 'SCHEDULE_COOLDOWN') {
                const na = e?.response?.data?.detail?.next_change_available_at;
                setMsg(`Смена доступна с ${na ? new Date(na).toLocaleDateString() : 'позже'}`);
            } else {
                setMsg('Не удалось сменить дни');
            }
        } finally { setBusy(false); }
    }, [draftDays, setMainDaysStore]);

    const cooldownText = sched && !sched.can_change_now && sched.next_change_available_at
        ? `Следующая смена доступна с ${new Date(sched.next_change_available_at).toLocaleDateString()}`
        : sched?.in_grace ? 'Первые 14 дней — смена бесплатно и без ограничений'
            : null;

    return (
        <div className="sched-settings" onClick={(e) => e.stopPropagation()}>
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
            </div>

            {/* Заморозки */}
            <div className="sched-freeze-badge">
                ❄️ Заморозки: {(freeFreezes ?? 0) + (paidFreezes ?? 0)}
                <span style={{ opacity: 0.5 }}> (бесплатных {freeFreezes ?? 0}, докупленных {paidFreezes ?? 0})</span>
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
                                <div key={wd} className="week-dot main">{DAY_LABELS[wd]?.[1]}</div>
                            ))}
                        </div>
                        <button
                            className="sched-save-btn"
                            style={{ marginTop: 10 }}
                            onClick={() => { setDraftDays([...mainDays]); setEditing(true); }}
                        >
                            Изменить дни main-тренировок
                        </button>
                        {cooldownText && <div className="sched-cooldown">{cooldownText}</div>}
                    </>
                )}
                {editing && (
                    <>
                        <ScheduleDaysPicker selected={draftDays} onChange={setDraftDays} disabled={busy} />
                        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                            <button className="sched-save-btn" disabled={busy || draftDays.length !== 3} onClick={saveDays}>
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
                    </>
                )}
            </div>

            {/* Light-режим: временная кнопка (в 8c переедет в витрину) */}
            <div>
                <div className="sched-row-label">Light-режим (лёгкая зарядка)</div>
                {!lightUnlocked ? (
                    <button className="sched-light-btn" disabled={busy} onClick={() => setTest('unlock')}>
                        ✨ Открыть light-режим ({unlockPrice} 💧)
                    </button>
                ) : (
                    <button className="sched-light-btn lock" disabled={busy} onClick={() => setTest('lock')}>
                        Закрыть light-режим ({lockPrice} 💧)
                    </button>
                )}
                <div className="sched-cooldown">
                    Light — 4 упражнения-зарядки. Стрик становится ежедневным (main + light-дни).
                </div>
            </div>

            {msg && <div className="sched-cooldown">{msg}</div>}

            {test === 'unlock' && (
                <DisclaimerTest
                    title="Открыть light-режим?"
                    intro={`Спишется ${unlockPrice} 💧. Активация — со следующего понедельника.`}
                    questions={UNLOCK_QUESTIONS}
                    confirmLabel="открыть light-режим"
                    onPass={doUnlock}
                    onCancel={() => setTest(null)}
                />
            )}
            {test === 'lock' && (
                <DisclaimerTest
                    title="Закрыть light-режим?"
                    intro={`Спишется ${lockPrice} 💧. Main-only — со следующего понедельника.`}
                    questions={LOCK_QUESTIONS}
                    confirmLabel="закрыть light-режим"
                    onPass={doLock}
                    onCancel={() => setTest(null)}
                />
            )}
        </div>
    );
};

export default PlayerSchedulePanel;
