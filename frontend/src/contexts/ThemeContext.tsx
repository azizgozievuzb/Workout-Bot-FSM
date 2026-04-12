import { createContext, useContext } from 'react';

export type AppTheme = 'dark' | 'light';

export const ThemeContext = createContext<AppTheme>('dark');

export const useTheme = (): AppTheme => useContext(ThemeContext);
