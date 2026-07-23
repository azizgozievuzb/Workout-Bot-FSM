import React, { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import api from '../../api/client';
import { hapticImpact, hapticNotification } from '../../utils/haptic';
import ScheduleDaysPicker from '../schedule/ScheduleDaysPicker';
import { setSchedule } from '../../api/schedule';
import './OnboardingFlow.css';

// In-app player survey (7.5). The invited player fills gender → fitness → age → goal,
// which POSTs /onboarding/complete and lifts the onboarding gate. Promo codes removed.

type Gender = 'male' | 'female';
type Fitness = 'beginner' | 'intermediate' | 'advanced';
type Age = '<18' | '18-25' | '26-35' | '36-45' | '46-55' | '55+';
type Goal = 'lose_weight' | 'build_muscle' | 'endurance' | 'health' | 'flexibility';

const GENDERS: [Gender, string][] = [['male', 'Мужской'], ['female', 'Женский']];
const FITNESS: [Fitness, string][] = [['beginner', 'Начинающий'], ['intermediate', 'Средний'], ['advanced', 'Продвинутый']];
const AGES: [Age, string][] = [['<18', 'До 18'], ['18-25', '18–25'], ['26-35', '26–35'], ['36-45', '36–45'], ['46-55', '46–55'], ['55+', '55+']];
const GOALS: [Goal, string][] = [['lose_weight', 'Похудеть'], ['build_muscle', 'Набрать массу'], ['endurance', 'Выносливость'], ['health', 'Здоровье'], ['flexibility', 'Гибкость']];

type Step = 'gender' | 'fitness' | 'age' | 'goal' | 'days';

const OnboardingFlow: React.FC = () => {
    const [step, setStep] = useState<Step>('gender');
    const [gender, setGender] = useState<Gender | null>(null);
    const [fitness, setFitness] = useState<Fitness | null>(null);
    const [age, setAge] = useState<Age | null>(null);
    const [goal, setGoal] = useState<Goal | null>(null);
    const [days, setDays] = useState<number[]>([]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    // Финальный шаг: сохраняем опрос + 3 main-дня, затем reload.
    const finish = useCallback(async () => {
        if (saving || !gender || !fitness || !age || !goal || days.length !== 3) return;
        setSaving(true);
        setError('');
        try {
            await api.post('/onboarding/complete', {
                gender, fitness_level: fitness, age_range: age, goal,
            });
            await setSchedule(days);
            hapticNotification('success');
            window.location.reload();
        } catch {
            setError('Не удалось сохранить. Попробуйте ещё раз.');
            hapticNotification('error');
            setSaving(false);
        }
    }, [saving, gender, fitness, age, goal, days]);

    const pick = <T,>(value: T, set: (v: T) => void, next?: Step) => {
        hapticImpact('light');
        set(value);
        if (next) setStep(next);
    };

    // Шаг выбора дней — отдельный рендер (не список кнопок).
    if (step === 'days') {
        return (
            <div className="onb-container" onClick={(e) => e.stopPropagation()}>
                <div className="promo-screen">
                    <motion.div
                        className="onb-card"
                        key="days"
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3 }}
                    >
                        <h2 className="onb-title">Выбери 3 дня тренировок</h2>
                        <p className="onb-subtitle">Шаг 5 из 5</p>
                        <ScheduleDaysPicker selected={days} onChange={setDays} disabled={saving} />
                        <button
                            className="onb-btn onb-btn--accent"
                            style={{ marginTop: 16 }}
                            disabled={saving || days.length !== 3}
                            onClick={(e) => { e.stopPropagation(); finish(); }}
                        >
                            {saving ? 'Сохраняем…' : 'Готово'}
                        </button>
                        {error && <div className="promo-error" style={{ marginTop: 12 }}>{error}</div>}
                    </motion.div>
                </div>
            </div>
        );
    }

    const options: { title: string; sub: string; items: [string, string][]; onPick: (v: string) => void } =
        step === 'gender' ? { title: 'Ваш пол', sub: 'Шаг 1 из 5', items: GENDERS, onPick: (v) => pick(v as Gender, setGender, 'fitness') }
            : step === 'fitness' ? { title: 'Уровень подготовки', sub: 'Шаг 2 из 5', items: FITNESS, onPick: (v) => pick(v as Fitness, setFitness, 'age') }
                : step === 'age' ? { title: 'Возраст', sub: 'Шаг 3 из 5', items: AGES, onPick: (v) => pick(v as Age, setAge, 'goal') }
                    : { title: 'Цель тренировок', sub: 'Шаг 4 из 5', items: GOALS, onPick: (v) => pick(v as Goal, setGoal, 'days') };

    return (
        <div className="onb-container" onClick={(e) => e.stopPropagation()}>
            <div className="promo-screen">
                <motion.div
                    className="onb-card"
                    key={step}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                >
                    <h2 className="onb-title">{options.title}</h2>
                    <p className="onb-subtitle">{options.sub}</p>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                        {options.items.map(([val, label]) => (
                            <button
                                key={val}
                                className="onb-btn onb-btn--accent"
                                disabled={saving}
                                onClick={(e) => { e.stopPropagation(); options.onPick(val); }}
                            >
                                {label}
                            </button>
                        ))}
                    </div>

                    {saving && <p className="onb-subtitle" style={{ marginTop: 12 }}>Сохраняем…</p>}
                    {error && <div className="promo-error" style={{ marginTop: 12 }}>{error}</div>}
                </motion.div>
            </div>
        </div>
    );
};

export default OnboardingFlow;
