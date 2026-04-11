import { create } from 'zustand';

interface AuthState {
  token: string | null;
  role: 'player' | 'responsible' | 'admin' | null;
  onboardingDone: boolean;
  photoUrl: string | null;
  isAuthenticated: boolean;
  setAuth: (token: string, role: string, onboardingDone: boolean, photoUrl?: string | null) => void;
  setPhotoUrl: (url: string) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  role: null,
  onboardingDone: false,
  photoUrl: null,
  isAuthenticated: false,
  setAuth: (token, role, onboardingDone, photoUrl = null) =>
    set({
      token,
      role: role as AuthState['role'],
      onboardingDone,
      photoUrl: photoUrl || null,
      isAuthenticated: true,
    }),
  setPhotoUrl: (url) => set({ photoUrl: url }),
  clearAuth: () =>
    set({ token: null, role: null, onboardingDone: false, photoUrl: null, isAuthenticated: false }),
}));
