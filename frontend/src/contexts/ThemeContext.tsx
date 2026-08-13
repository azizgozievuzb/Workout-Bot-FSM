import { createContext, useContext } from 'react';

export type AppTheme = 'dark' | 'light';

/* S64-4: тема переключается явной кнопкой на экране профиля, а не скрытым
   жестом, — значит потребителям нужен не только цвет, но и путь к сеттеру.
   Контекст отдаёт объект, но старый `useTheme()` сохраняет прежнюю сигнатуру
   (возвращает тему), чтобы RoleTransition не переписывать. */
export interface ThemeContextValue {
    theme: AppTheme;
    toggleTheme: () => void;
}

export const ThemeContext = createContext<ThemeContextValue>({
    theme: 'dark',
    toggleTheme: () => {},
});

export const useTheme = (): AppTheme => useContext(ThemeContext).theme;

export const useThemeToggle = (): (() => void) => useContext(ThemeContext).toggleTheme;
