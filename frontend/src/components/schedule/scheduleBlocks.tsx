import React, { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/authStore';
import {
    DAY_LABELS, getSchedule, setSchedule, setMorningReminderTime,
    cancelPendingSchedule, type ScheduleState,
} from '../../api/schedule';
import ScheduleDaysPicker from './ScheduleDaysPicker';
import ConfirmSpendModal from '../shared/ConfirmSpendModal';
import { hapticNotification } from '../../utils/haptic';
import './schedule.css';

/* S64-3/S64-7 — расписание разрезано на блоки, потому что у его кусков разные дома:
   ежедневное (неделя · заморозки · дни main · инфо про light) живёт в Action-кубе,
   редко-настраиваемое (имя+звание · время напоминания) — на экране профиля,
   а скрытая сводка показывает всё это ЗЕРКАЛОМ (S64-5а). Три точки рендера
   собираются из ЭТИХ блоков — копипасты быть не должно. */

export function todayWeekday(): number {
    // JS getDay(): 0=Вс…6=Сб → наш формат 0=Пн…6=Вс
    return (new Date().getDay() + 6) % 7;
}
export function todayISO(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function fmtDate(iso: string): string {
    // 'YYYY-MM-DD' → 'DD.MM'
    const [, m, d] = iso.split('-');
    return d && m ? `${d}.${m}` : iso;
}

/** Своя загрузка расписания — для точек рендера, где готового `sched` нет. */
export function useScheduleState() {
    const [sched, setSched] = useState<ScheduleState | null>(null);
    useEffect(() => {
        getSchedule().then(setSched).catch(() => {});
    }, []);
    return { sched, setSched };
}

/** Дни main: пока расписание не приехало — из стора, чтобы неделя не пустовала. */
function useMainDays(sched: ScheduleState | null): number[] {
    const storeMain = useAuthStore((s) => s.mainDays);
    return sched?.main_days ?? storeMain ?? [];
}

/* ---------- Имя + звание ---------- */

export const PlayerIdentityBlock: React.FC<{
    firstName?: string | null;
    playerTitle?: string | null;
}> = ({ firstName, playerTitle }) => {
    if (!firstName && !playerTitle) return null;
    return (
        <div className="player-identity">
            <div className="player-identity-name">{firstName || 'Игрок'}</div>
            {playerTitle && <div className="player-title-line">🏅 {playerTitle}</div>}
        </div>
    );
};

/* ---------- «Твоя неделя» ---------- */

export const WeekBlock: React.FC<{
    sched: ScheduleState | null;
    lastClosedDay?: string | null;
}> = ({ sched, lastClosedDay }) => {
    const mainDays = useMainDays(sched);
    const tWd = todayWeekday();
    const tISO = todayISO();
    const lightActive = sched?.light_active ?? false;

    return (
        <div>
            <div className="sched-row-label">Твоя неделя</div>
            {/* Индикатор недели — в light-режиме main/light-дни разными маркерами */}
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
    );
};

/* ---------- Заморозки ---------- */

export const FreezeBlock: React.FC<{
    freeFreezes?: number;
    paidFreezes?: number;
}> = ({ freeFreezes, paidFreezes }) => (
    <div className="sched-freeze-badge">
        ❄️ Заморозки: {(freeFreezes ?? 0) + (paidFreezes ?? 0)}
        {/* Не «докупленных»: в этой цифре лежат и подаренные наставником
            заморозки (смоук S63) — слово врало про происхождение. */}
        <span style={{ opacity: 0.5 }}> (бесплатных {freeFreezes ?? 0}, в запасе {paidFreezes ?? 0})</span>
    </div>
);

/* ---------- Время утреннего напоминания ---------- */

export const ReminderBlock: React.FC = () => {
    const storeReminder = useAuthStore((s) => s.morningReminderTime);
    const setReminderStore = useAuthStore((s) => s.setMorningReminderTime);
    const [time, setTime] = useState<string>(storeReminder || '08:00');
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');

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

    return (
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
            {msg && <div className="sched-cooldown">{msg}</div>}
        </div>
    );
};

/* ---------- «Дни main-тренировок» + платная смена ---------- */

export const MainDaysBlock: React.FC<{
    sched: ScheduleState | null;
    setSched: (s: ScheduleState) => void;
    dropsBalance?: number;
    /** Дёргается после успешной платной смены — чтобы баланс на экране обновился. */
    onSpent?: () => void;
}> = ({ sched, setSched, dropsBalance, onSpent }) => {
    const setMainDaysStore = useAuthStore((s) => s.setMainDays);
    const mainDays = useMainDays(sched);

    const [editing, setEditing] = useState(false);
    const [draftDays, setDraftDays] = useState<number[]>([]);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');
    /* П.7: смена графика вне grace — необратимая трата, окно обязательно. */
    const [confirmChange, setConfirmChange] = useState(false);
    /* S64-13: отмена заявки — тоже окно: капли возвращаются, но действие
       заметное (дни останутся старыми). */
    const [confirmCancel, setConfirmCancel] = useState(false);

    const changePrice = sched?.schedule_change_price ?? null;
    const inGrace = sched?.in_grace ?? false;
    /* Заявка ждёт понедельника: её дни правятся бесплатно, а сама она
       отменяется с полным возвратом уплаченного (S64-13). */
    const hasPending = !!(sched?.pending_main_days && sched.pending_schedule_from);
    const refundAmount = sched?.pending_schedule_paid_drops ?? 0;

    const saveDays = useCallback(async () => {
        if (draftDays.length !== 3) return;
        setBusy(true); setMsg('');
        try {
            const res = await setSchedule(draftDays);
            setSched(res);
            setMainDaysStore(res.main_days ?? draftDays);
            hapticNotification('success');
            setEditing(false);
            onSpent?.();
            if (res.pending_main_days) {
                /* Ни покупку, ни правку заявки НЕ комментируем строкой (решения
                   юзера на смоуке, пп.3 и 6): всё, что тут можно сказать, уже
                   сказано постоянной строкой «📅 С понедельника … : дни» —
                   вторая строка про ту же дату была дублем. */
                setMsg('');
            } else {
                setMsg('Расписание обновлено');
            }
        } catch (e: any) {
            hapticNotification('error');
            const detail = e?.response?.data?.detail;
            const code = typeof detail === 'object' ? detail?.code : '';
            if (code === 'PENDING_ALREADY_DUE') {
                setMsg('Выбранные дни уже вступают в силу — изменить их можно после понедельника');
            } else if (code === 'INSUFFICIENT_DROPS') {
                setMsg(`Недостаточно капель: ${detail?.balance ?? 0}/${detail?.price ?? ''} 💧`);
            } else {
                setMsg('Не удалось сменить дни');
            }
        } finally { setBusy(false); setConfirmChange(false); }
    }, [draftDays, setMainDaysStore, setSched, onSpent]);

    /* S64-13: отмена заявки до вступления — полный возврат уплаченного. */
    const doCancel = useCallback(async () => {
        setBusy(true); setMsg('');
        try {
            const res = await cancelPendingSchedule();
            setSched(res);
            setMainDaysStore(res.main_days ?? []);
            hapticNotification('success');
            setEditing(false);
            onSpent?.();
            /* Итог отмены НЕ комментируем строкой (решение юзера на смоуке):
               возврат обещан в окне подтверждения ДО действия, а после отмены
               строка «📅 С понедельника …» исчезает и возвращается кнопка
               покупки — этого достаточно. */
            setMsg('');
        } catch (e: any) {
            hapticNotification('error');
            const detail = e?.response?.data?.detail;
            const code = typeof detail === 'object' ? detail?.code : '';
            if (code === 'PENDING_ALREADY_DUE') {
                setMsg('Новые дни уже вступают в силу — отменить не получится');
            } else if (code === 'NO_PENDING') {
                setMsg('Отменять нечего — смена не заказана');
            } else {
                setMsg('Не удалось отменить смену');
            }
        } finally { setBusy(false); setConfirmCancel(false); }
    }, [refundAmount, setMainDaysStore, setSched, onSpent]);

    /* Платим только за НОВУЮ заявку. Бесплатны: первичная установка, grace и
       правка уже оплаченной заявки (S64-13 — это правка черновика, не покупка).
       Кулдаун 30 дней удалён вместе с серым состоянием кнопки. */
    const paidChange = !inGrace && !!changePrice && !hasPending;
    const submitDays = useCallback(() => {
        if (draftDays.length !== 3) return;
        if (paidChange) { setConfirmChange(true); return; }
        void saveDays();
    }, [draftDays.length, paidChange, saveDays]);

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

    /* S64-13: кулдауна больше нет — осталась только подсказка про grace. */
    const graceText = sched?.in_grace
        ? 'Первые 14 дней — смена бесплатно и без ограничений' : null;

    return (
        <div>
            {/* Смоук 30.08 (2-й заход): заголовок «Дни main-тренировок» + кнопка
                «Сменить за 100 💧» под ним — две строки об одном. Заголовок убран,
                смысл переехал в саму кнопку. Заголовок остаётся только в режиме
                правки и когда ждём понедельника — там под ним есть что показать.
                Полоска вт·чт·сб дублировала блок «Твоя неделя» выше и в обычном
                виде тоже убрана; при ожидании понедельника она нужна — показывает
                УХОДЯЩИЕ дни, которых в «Твоей неделе» не видно. */}
            {(editing || hasPending) && (
                <div className="sched-row-label">Дни main-тренировок</div>
            )}
            {!editing && (
                <>
                    {hasPending && (
                        <div className="week-strip">
                            {mainDays.map((wd) => (
                                <div key={wd}
                                    className={`week-dot main${
                                        sched?.pending_main_days
                                        && !sched.pending_main_days.includes(wd) ? ' week-dot--leaving' : ''}`}>
                                    {DAY_LABELS[wd]?.[1]}</div>
                            ))}
                        </div>
                    )}
                    {/* S64-13: пока заявка ждёт понедельника — два действия:
                        поправить выбор бесплатно или отменить с возвратом. */}
                    {hasPending ? (
                        <div className="sched-pending-actions">
                            <button
                                className="sched-save-btn"
                                onClick={() => {
                                    setDraftDays([...(sched?.pending_main_days ?? mainDays)]);
                                    setEditing(true);
                                }}
                            >
                                Изменить (бесплатно)
                            </button>
                            <button
                                className="sched-save-btn"
                                style={{ background: 'rgba(255,255,255,0.12)' }}
                                onClick={() => setConfirmCancel(true)}
                            >
                                {refundAmount ? `Отменить — вернём ${refundAmount} 💧` : 'Отменить смену'}
                            </button>
                        </div>
                    ) : (
                        <button
                            className="sched-save-btn"
                            style={{ marginTop: 10 }}
                            onClick={() => { setDraftDays([...mainDays]); setEditing(true); }}
                        >
                            {/* 8c: вне grace смена платная */}
                            {!inGrace && changePrice
                                ? `Сменить дни тренировок — ${changePrice} 💧`
                                : 'Сменить дни тренировок'}
                        </button>
                    )}
                </>
            )}
            {editing && (
                <>
                    <ScheduleDaysPicker selected={draftDays} onChange={setDraftDays} disabled={busy} />
                    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                        <button
                            className="sched-save-btn"
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
                    {/* Подсказки «правка бесплатна» тут нет: слово «(бесплатно)»
                        стоит на самой кнопке, которая эту форму и открыла
                        (решение юзера на смоуке п.4). */}
                </>
            )}
            {pendingText && (
                <div className="sched-cooldown sched-cooldown--pending">📅 {pendingText}</div>
            )}
            {graceText && <div className="sched-cooldown">{graceText}</div>}
            {msg && <div className="sched-cooldown">{msg}</div>}

            {confirmChange && changePrice !== null && (
                <ConfirmSpendModal
                    title="📅 Сменить дни тренировок"
                    price={changePrice}
                    /* Живые данные, не снапшот открытия формы (урок 13a). */
                    balance={dropsBalance ?? 0}
                    note="Новые дни вступят в силу со следующего понедельника."
                    confirmLabel="Сменить"
                    busy={busy}
                    onConfirm={() => { void saveDays(); }}
                    onCancel={() => setConfirmChange(false)}
                />
            )}

            {/* S64-13: отмена заказанной смены — капли возвращаются полностью. */}
            {confirmCancel && (
                <ConfirmSpendModal
                    title="📅 Отменить смену дней"
                    price={null}
                    balance={dropsBalance ?? 0}
                    freeLabel={refundAmount ? `Вернём ${refundAmount} 💧` : 'Капли не спишутся'}
                    note="Дни тренировок останутся прежними."
                    confirmLabel="Отменить смену"
                    cancelLabel="Оставить"
                    busy={busy}
                    onConfirm={() => { void doCancel(); }}
                    onCancel={() => setConfirmCancel(false)}
                />
            )}
        </div>
    );
};

/* ---------- Инфо-строка про light ---------- */

export const LightInfoBlock: React.FC = () => (
    <div>
        {/* 8c: покупки light переехали в витрину (MarketCube).
            Смоук 30.08: заголовок «Light-режим (лёгкая зарядка)» снят — следующая
            строка объясняет то же самое и своими словами. */}
        <div className="sched-cooldown">
            Light — 4 упражнения-зарядки, стрик становится ежедневным.
        </div>
        {/* Смоук 30.08 (2-й заход): ссылкой должна быть ТОЛЬКО «в магазине →»,
            а не вся фраза — иначе кликабельным выглядит и то, что никуда не ведёт. */}
        <div className="sched-cooldown">
            Открыть или закрыть light-режим —{' '}
            <button
                className="sched-goto-market"
                onClick={() => window.dispatchEvent(
                    new CustomEvent('app:goto-module', { detail: 'Market' }))}
            >
                в магазине →
            </button>
        </div>
    </div>
);

/* ---------- Композиция для Action-куба (S64-3) ----------
   Ежедневное расписание игрока. Имя/звание и напоминание сюда НЕ едут —
   их дом профиль (S64-7). Рендерится ПОД кнопками запуска тренировки:
   первое, что видит игрок в Action, — кнопка «Приступим». */

export const PlayerScheduleSection: React.FC<{
    sched: ScheduleState | null;
    setSched: (s: ScheduleState) => void;
    lastClosedDay?: string | null;
    freeFreezes?: number;
    paidFreezes?: number;
    dropsBalance?: number;
    onSpent?: () => void;
}> = ({ sched, setSched, lastClosedDay, freeFreezes, paidFreezes, dropsBalance, onSpent }) => (
    <div className="sched-settings sched-settings--cube" onClick={(e) => e.stopPropagation()}>
        <WeekBlock sched={sched} lastClosedDay={lastClosedDay} />
        <FreezeBlock freeFreezes={freeFreezes} paidFreezes={paidFreezes} />
        <MainDaysBlock sched={sched} setSched={setSched} dropsBalance={dropsBalance} onSpent={onSpent} />
        <LightInfoBlock />
    </div>
);
