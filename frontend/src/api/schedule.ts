import api from './client';

// Дни недели: 0=Пн … 6=Вс (совместимо с Python date.weekday()).
export const DAY_LABELS: [number, string][] = [
    [0, 'Пн'], [1, 'Вт'], [2, 'Ср'], [3, 'Чт'], [4, 'Пт'], [5, 'Сб'], [6, 'Вс'],
];

export interface ScheduleState {
    main_days: number[] | null;
    pending_main_days: number[] | null;
    pending_schedule_from: string | null;
    grace_until: string | null;
    in_grace: boolean;
    next_change_available_at: string | null;
    can_change_now: boolean;
}

export async function getSchedule(): Promise<ScheduleState> {
    const { data } = await api.get('/players/me/schedule');
    return data;
}

export async function setSchedule(mainDays: number[]): Promise<ScheduleState> {
    const { data } = await api.patch('/players/me/schedule', { main_days: mainDays });
    return data;
}

export async function setMorningReminderTime(time: string): Promise<void> {
    // time: 'HH:MM'
    await api.patch('/players/me/reminder-time', { morning_reminder_time: time });
}

// Тихое сохранение детектированной TZ (вызывается при auth).
export async function saveDetectedTimezone(): Promise<void> {
    let tz = '';
    try {
        tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch {
        tz = '';
    }
    if (!tz) return;
    try {
        await api.patch('/users/me/timezone', { timezone: tz });
    } catch {
        // тихо — не критично для входа
    }
}

// 3 дня подряд (линейно) → warning про восстановление.
export function isConsecutive(days: number[]): boolean {
    if (days.length !== 3) return false;
    const s = [...days].sort((a, b) => a - b);
    return s[1] === s[0] + 1 && s[2] === s[1] + 1;
}
