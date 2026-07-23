import React, { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import ScheduleDaysPicker from './ScheduleDaysPicker';
import { setSchedule } from '../../api/schedule';
import { useAuthStore } from '../../stores/authStore';
import { hapticNotification } from '../../utils/haptic';
import '../onboarding/OnboardingFlow.css';

// Гейт довыбора 3 main-дней для существующих игроков без main_days (релиз 8a).
const ScheduleGate: React.FC = () => {
    const setMainDays = useAuthStore((s) => s.setMainDays);
    const [days, setDays] = useState<number[]>([]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const save = useCallback(async () => {
        if (saving || days.length !== 3) return;
        setSaving(true);
        setError('');
        try {
            const res = await setSchedule(days);
            hapticNotification('success');
            setMainDays(res.main_days ?? days);
        } catch {
            setError('Не удалось сохранить. Попробуйте ещё раз.');
            hapticNotification('error');
            setSaving(false);
        }
    }, [saving, days, setMainDays]);

    return (
        <div className="onb-container" onClick={(e) => e.stopPropagation()}>
            <div className="promo-screen">
                <motion.div
                    className="onb-card"
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                >
                    <h2 className="onb-title">Выбери 3 дня тренировок</h2>
                    <p className="onb-subtitle">
                        Эти дни определяют твой стрик. Пропуск планового дня расходует
                        заморозку или обнуляет стрик.
                    </p>
                    <ScheduleDaysPicker selected={days} onChange={setDays} disabled={saving} />
                    <button
                        className="onb-btn onb-btn--accent"
                        style={{ marginTop: 16 }}
                        disabled={saving || days.length !== 3}
                        onClick={(e) => { e.stopPropagation(); save(); }}
                    >
                        {saving ? 'Сохраняем…' : 'Готово'}
                    </button>
                    {error && <div className="promo-error" style={{ marginTop: 12 }}>{error}</div>}
                </motion.div>
            </div>
        </div>
    );
};

export default ScheduleGate;
