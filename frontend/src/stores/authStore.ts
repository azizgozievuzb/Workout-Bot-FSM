import { create } from 'zustand';

interface AuthState {
  token: string | null;
  role: 'player' | 'responsible' | 'admin' | null;
  onboardingDone: boolean;
  photoUrl: string | null;
  photoDarkUrl: string | null;
  photoLightUrl: string | null;
  isAuthenticated: boolean;
  setAuth: (token: string, role: string, onboardingDone: boolean, photoUrl?: string | null, photoDarkUrl?: string | null, photoLightUrl?: string | null) => void;
  setPhotoUrl: (url: string) => void;
  setStyledPhotos: (darkUrl: string | null, lightUrl: string | null) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  role: null,
  onboardingDone: false,
  photoUrl: null,
  photoDarkUrl: null,
  photoLightUrl: null,
  isAuthenticated: false,
  setAuth: (token, role, onboardingDone, photoUrl = null, photoDarkUrl = null, photoLightUrl = null) =>
    set({
      token,
      role: role as AuthState['role'],
      onboardingDone,
      photoUrl: photoUrl || null,
      photoDarkUrl: photoDarkUrl || null,
      photoLightUrl: photoLightUrl || null,
      isAuthenticated: true,
    }),
  setPhotoUrl: (url) => set({ photoUrl: url }),
  setStyledPhotos: (darkUrl, lightUrl) => set({ photoDarkUrl: darkUrl, photoLightUrl: lightUrl }),
  clearAuth: () =>
    set({ token: null, role: null, onboardingDone: false, photoUrl: null, photoDarkUrl: null, photoLightUrl: null, isAuthenticated: false }),
}));
