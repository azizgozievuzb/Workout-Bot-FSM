import { create } from 'zustand';

interface AuthState {
  token: string | null;
  role: 'player' | 'responsible' | 'admin' | null;
  onboardingDone: boolean;
  isAuthenticated: boolean;
  setAuth: (token: string, role: string, onboardingDone: boolean) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  role: null,
  onboardingDone: false,
  isAuthenticated: false,
  setAuth: (token, role, onboardingDone) =>
    set({
      token,
      role: role as AuthState['role'],
      onboardingDone,
      isAuthenticated: true,
    }),
  clearAuth: () =>
    set({ token: null, role: null, onboardingDone: false, isAuthenticated: false }),
}));
