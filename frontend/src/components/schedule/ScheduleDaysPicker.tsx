import React from 'react';
import { DAY_LABELS, isConsecutive } from '../../api/schedule';
import { hapticImpact } from '../../utils/haptic';
import './schedule.css';

interface Props {
    selected: number[];
    onChange: (days: number[]) => void;
    disabled?: boolean;
}

// Чипы пн–вс, выбор ровно 3 дней. Предупреждение при 3 подряд.
const ScheduleDaysPicker: React.FC<Props> = ({ selected, onChange, disabled }) => {
    const toggle = (day: number) => {
        if (disabled) return;
        hapticImpact('light');
        if (selected.includes(day)) {
            onChange(selected.filter((d) => d !== day));
        } else if (selected.length < 3) {
            onChange([...selected, day].sort((a, b) => a - b));
        }
        // если уже 3 выбрано и тапнули новый — игнор (сначала снять)
    };

    const full = selected.length === 3;
    const warn = full && isConsecutive(selected);

    return (
        <div className="sched-picker">
            <div className="sched-chips">
                {DAY_LABELS.map(([day, label]) => {
                    const on = selected.includes(day);
                    const locked = !on && full;
                    return (
                        <button
                            key={day}
                            type="button"
                            className={`sched-chip ${on ? 'on' : ''} ${locked ? 'locked' : ''}`}
                            disabled={disabled || locked}
                            onClick={(e) => { e.stopPropagation(); toggle(day); }}
                        >
                            {label}
                        </button>
                    );
                })}
            </div>
            {/* Счётчика «Выбрано N из 3» здесь нет (решение юзера на смоуке
                S64-13): кнопка «Сохранить» оживает ровно на трёх днях, а лишние
                чипы гаснут сами — правило читается из поведения. */}
            {warn && (
                <p className="sched-warn">
                    ⚠️ Для восстановления лучше тренироваться с промежутками, а не 3 дня подряд.
                </p>
            )}
        </div>
    );
};

export default ScheduleDaysPicker;
