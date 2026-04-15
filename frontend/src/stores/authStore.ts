import { create } from 'zustand';

export type PrimaryRole = 'player' | 'responsible';

const CACHE_KEYS = { photo: 'wb_photo', dark: 'wb_photo_dark', light: 'wb_photo_light' } as const;
export type LegacyRole = 'player' | 'responsible' | 'admin';

export interface DualRoleUser {
  primary_role: PrimaryRole;
  has_player_access: boolean;
  has_responsible_access: boolean;
  is_admin: boolean;
}

type ActiveRoleView = 'player' | 'responsible';

interface AuthState {
  token: string | null;
  role: LegacyRole | null;
  primary_role: PrimaryRole | null;
  has_player_access: boolean;
  has_responsible_access: boolean;
  is_admin: boolean;
  onboardingDone: boolean;
  photoUrl: string | null;
  photoDarkUrl: string | null;
  photoLightUrl: string | null;
  isAuthenticated: boolean;
  player_code: string | null;
  activeRoleView: ActiveRoleView | null;
  accessRevoked: boolean;
  setActiveRoleView: (view: ActiveRoleView) => void;
  setAccessRevoked: (revoked: boolean) => void;
  setAuth: (data: {
    token: string;
    role: string;
    primary_role?: string;
    has_player_access?: boolean;
    has_responsible_access?: boolean;
    is_admin?: boolean;
    onboardingDone: boolean;
    photoUrl?: string | null;
    photoDarkUrl?: string | null;
    photoLightUrl?: string | null;
  }) => void;
  setPhotoUrl: (url: string) => void;
  setStyledPhotos: (darkUrl: string | null, lightUrl: string | null) => void;
  setPlayerCode: (code: string | null) => void;
  addRole: (role: 'player' | 'responsible') => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  role: null,
  primary_role: null,
  has_player_access: false,
  has_responsible_access: false,
  is_admin: false,
  onboardingDone: false,
  photoUrl: localStorage.getItem(CACHE_KEYS.photo),
  photoDarkUrl: localStorage.getItem(CACHE_KEYS.dark),
  photoLightUrl: localStorage.getItem(CACHE_KEYS.light),
  player_code: null,
  activeRoleView: null,
  isAuthenticated: false,
  accessRevoked: localStorage.getItem('access_revoked') === '1',
  setActiveRoleView: (view) => set({ activeRoleView: view }),
  setAccessRevoked: (revoked) => {
    if (revoked) {
      localStorage.setItem('access_revoked', '1');
      set({ accessRevoked: true, token: null, isAuthenticated: false });
    } else {
      localStorage.removeItem('access_revoked');
      set({ accessRevoked: false });
    }
  },
  setAuth: (data) => {
    localStorage.removeItem('access_revoked');
    if (data.photoUrl) localStorage.setItem(CACHE_KEYS.photo, data.photoUrl);
    else if (data.photoUrl === null) localStorage.removeItem(CACHE_KEYS.photo);
    if (data.photoDarkUrl) localStorage.setItem(CACHE_KEYS.dark, data.photoDarkUrl);
    else if (data.photoDarkUrl === null) localStorage.removeItem(CACHE_KEYS.dark);
    if (data.photoLightUrl) localStorage.setItem(CACHE_KEYS.light, data.photoLightUrl);
    else if (data.photoLightUrl === null) localStorage.removeItem(CACHE_KEYS.light);
    return set({
      token: data.token,
      role: data.role as LegacyRole,
      primary_role: (data.primary_role as PrimaryRole) || (data.role as PrimaryRole) || null,
      has_player_access: data.has_player_access ?? (data.role === 'player'),
      has_responsible_access: data.has_responsible_access ?? (data.role === 'responsible'),
      is_admin: data.is_admin ?? (data.role === 'admin'),
      onboardingDone: data.onboardingDone,
      photoUrl: data.photoUrl || null,
      photoDarkUrl: data.photoDarkUrl || null,
      photoLightUrl: data.photoLightUrl || null,
      isAuthenticated: true,
    });
  },
  setPhotoUrl: (url) => { localStorage.setItem(CACHE_KEYS.photo, url); set({ photoUrl: url }); },
  setStyledPhotos: (darkUrl, lightUrl) => {
    if (darkUrl) localStorage.setItem(CACHE_KEYS.dark, darkUrl); else localStorage.removeItem(CACHE_KEYS.dark);
    if (lightUrl) localStorage.setItem(CACHE_KEYS.light, lightUrl); else localStorage.removeItem(CACHE_KEYS.light);
    set({ photoDarkUrl: darkUrl, photoLightUrl: lightUrl });
  },
  setPlayerCode: (code) => set({ player_code: code }),
  addRole: (role) =>
    set((state) => ({
      ...(role === 'player'
        ? { has_player_access: true }
        : { has_responsible_access: true }),
      role: state.is_admin ? 'admin' : state.primary_role,
    })),
  clearAuth: () => {
    localStorage.removeItem(CACHE_KEYS.photo);
    localStorage.removeItem(CACHE_KEYS.dark);
    localStorage.removeItem(CACHE_KEYS.light);
    set({
      token: null,
      role: null,
      primary_role: null,
      has_player_access: false,
      has_responsible_access: false,
      is_admin: false,
      onboardingDone: false,
      photoUrl: null,
      photoDarkUrl: null,
      photoLightUrl: null,
      player_code: null,
      activeRoleView: null,
      isAuthenticated: false,
      accessRevoked: false,
    });
  },
}));
