import { createContext, useContext } from 'react';

export type AppTheme = 'dark' | 'light';

/* S66: у темы теперь ТРИ состояния, а не два (решение юзера 31.08). `mode` —
   что выбрал человек, `theme` — во что это превратилось на экране. Они
   расходятся ровно в режиме `auto`: там цвет берётся от клиента Telegram
   (а если он молчит — от системной темы устройства). */
export type ThemeMode = 'light' | 'dark' | 'auto';

/* S64-4: тема переключается явной кнопкой, а не скрытым жестом, — значит
   потребителям нужен не только цвет, но и путь к переключателю.
   Контекст отдаёт объект, но старый `useTheme()` сохраняет прежнюю сигнатуру
   (возвращает тему), чтобы RoleTransition не переписывать. */
export interface ThemeContextValue {
    theme: AppTheme;
    mode: ThemeMode;
    /** Следующее состояние по кругу: светлая → тёмная → как в Telegram. */
    cycleTheme: () => void;
}

export const ThemeContext = createContext<ThemeContextValue>({
    theme: 'dark',
    mode: 'dark',
    cycleTheme: () => {},
});

export const useTheme = (): AppTheme => useContext(ThemeContext).theme;

export const useThemeMode = (): ThemeMode => useContext(ThemeContext).mode;

export const useThemeCycle = (): (() => void) => useContext(ThemeContext).cycleTheme;
