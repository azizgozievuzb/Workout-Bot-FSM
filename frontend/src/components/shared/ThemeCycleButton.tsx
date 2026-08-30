import React from 'react';
import { useThemeMode, useThemeCycle } from '../../contexts/ThemeContext';
import { hapticImpact } from '../../utils/haptic';

/* S66 (решение юзера 31.08). Переключатель темы переехал из строки «Оформление»
   на экране профиля сюда — к кнопке «Закрыть», где он виден с любого экрана.
   Состояний ТРИ, по кругу: светлая → тёмная → как в Telegram. Третье нужно,
   чтобы приложение не спорило с клиентом: у кого Telegram тёмный, у того и
   мини-апп тёмный, без ручной подстройки.

   Подпись под иконкой сознательно НЕ рисуем: три эмодзи читаются сами, а
   лишний текст на экране — ровно то, от чего юзер уходит (минимализм). */

const ICONS = { light: '☀️', dark: '🌙', auto: '📱' } as const;
const LABELS = {
    light: 'Тема: светлая',
    dark: 'Тема: тёмная',
    auto: 'Тема: как в Telegram',
} as const;

const ThemeCycleButton: React.FC = () => {
    const mode = useThemeMode();
    const cycle = useThemeCycle();

    return (
        <button
            className="theme-cycle-btn"
            aria-label={LABELS[mode]}
            title={LABELS[mode]}
            onClick={(e) => { e.stopPropagation(); hapticImpact('light'); cycle(); }}
        >
            {ICONS[mode]}
        </button>
    );
};

export default ThemeCycleButton;
