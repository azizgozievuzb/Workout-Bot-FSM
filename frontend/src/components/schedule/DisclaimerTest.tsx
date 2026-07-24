import React, { useState } from 'react';
import { hapticNotification } from '../../utils/haptic';

export interface DisclaimerQuestion {
    q: string;
    options: string[];
    correct: number;   // индекс правильного варианта
}

interface Props {
    title: string;
    intro?: string;
    questions: DisclaimerQuestion[];
    confirmLabel: string;
    onPass: () => void;
    onCancel: () => void;
}

/**
 * Дисклеймер-тест (§8.10) — 3 вопроса с вариантами, хардкод во фронте.
 * Неверный ответ → тест начинается заново. Все верно → onPass.
 */
const DisclaimerTest: React.FC<Props> = ({ title, intro, questions, confirmLabel, onPass, onCancel }) => {
    const [step, setStep] = useState(0);
    const [wrong, setWrong] = useState(false);

    const cur = questions[step];

    const answer = (idx: number) => {
        if (idx !== cur.correct) {
            hapticNotification('error');
            setWrong(true);
            setStep(0);   // начать заново
            return;
        }
        hapticNotification('success');
        setWrong(false);
        if (step + 1 >= questions.length) {
            onPass();
        } else {
            setStep(step + 1);
        }
    };

    return (
        <div className="disclaimer-backdrop" onClick={onCancel}>
            <div className="disclaimer-card" onClick={(e) => e.stopPropagation()}>
                <div className="disclaimer-title">{title}</div>
                {intro && <div className="disclaimer-intro">{intro}</div>}

                <div className="disclaimer-progress">Вопрос {step + 1} из {questions.length}</div>
                {wrong && <div className="disclaimer-wrong">Неверно — начнём сначала.</div>}

                <div className="disclaimer-q">{cur.q}</div>
                <div className="disclaimer-options">
                    {cur.options.map((opt, i) => (
                        <button key={i} className="disclaimer-option" onClick={() => answer(i)}>
                            {opt}
                        </button>
                    ))}
                </div>

                <button className="disclaimer-cancel" onClick={onCancel}>Отмена</button>
                <div className="disclaimer-hint">Пройди тест, чтобы подтвердить: {confirmLabel}</div>
            </div>
        </div>
    );
};

// Хардкод-тесты (§8.10)
export const UNLOCK_QUESTIONS: DisclaimerQuestion[] = [
    {
        q: 'Как изменится стрик после открытия light-режима?',
        options: [
            'Стрик нужно закрывать КАЖДЫЙ день (main или light)',
            'Стрик как раньше — только в main-дни',
            'Стрик вообще отключится',
        ],
        correct: 0,
    },
    {
        q: 'Что будет, если пропустить любой плановый день без заморозки?',
        options: [
            'Ничего страшного',
            'Стрик сломается',
            'Спишутся капли',
        ],
        correct: 1,
    },
    {
        q: 'Когда light-режим активируется?',
        options: [
            'Сразу сейчас',
            'Через месяц',
            'Со следующего понедельника',
        ],
        correct: 2,
    },
];

export const LOCK_QUESTIONS: DisclaimerQuestion[] = [
    {
        q: 'Что будет со стриком после закрытия light-режима?',
        options: [
            'Стрик снова только по main-дням',
            'Стрик обнулится',
            'Ничего не изменится',
        ],
        correct: 0,
    },
    {
        q: 'Когда main-only режим вступит в силу?',
        options: [
            'Сразу сейчас',
            'Со следующего понедельника (текущую неделю доигрываем)',
            'Через месяц',
        ],
        correct: 1,
    },
    {
        q: 'Повторное открытие light-режима позже:',
        options: [
            'Бесплатное',
            'Недоступно',
            'Платное по обычной цене',
        ],
        correct: 2,
    },
];

export default DisclaimerTest;
