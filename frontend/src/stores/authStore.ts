import { create } from 'zustand';

export type PrimaryRole = 'player' | 'responsible';

const CACHE_KEYS = {
  photo: 'wb_photo',
  dark: 'wb_photo_dark',
  light: 'wb_photo_light',
  ownTier: 'wb_own_tier',
  playerTier: 'wb_player_tier',
  streakFreeze: 'wb_streak_freeze',
  unreadNotifs: 'wb_unread_notifs',
  gender: 'wb_gender',
} as const;
export type LegacyRole = 'player' | 'responsible' | 'admin' | 'new';
export type AccessTier = 'standard' | 'premium' | 'elite';

export interface BanInfo {
    until: string | null;
    reason: string | null;
    missed: number;
}

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
  maintenanceMode: boolean;
  banInfo: BanInfo | null;
  onboardingBlocked: boolean;
  onboardingBlockedMessage: string | null;
  // --- Tier (3.1) ---
  ownAccessTier: AccessTier | null;
  playerViewTier: AccessTier | null;
  // --- Wallet / balance fields (3.1) ---
  shopFreezeBalance: number;
  giftFreezeBalance: number;
  streakFreezeBalance: number;
  restDaysRemaining: number;
  hasActivePartnerships: boolean;
  unreadNotifications: number;
  daysLeft: number | null;
  gender: string | null;
  // --- Computed ---
  effectiveTier: () => AccessTier | null;
  // --- Setters ---
  setActiveRoleView: (view: ActiveRoleView) => void;
  setAccessRevoked: (revoked: boolean) => void;
  setMaintenanceMode: (on: boolean) => void;
  setBanInfo: (info: BanInfo | null) => void;
  setOnboardingBlocked: (message: string | null) => void;
  setOwnAccessTier: (tier: AccessTier | null) => void;
  setPlayerViewTier: (tier: AccessTier | null) => void;
  setShopFreezeBalance: (v: number) => void;
  setGiftFreezeBalance: (v: number) => void;
  setStreakFreezeBalance: (v: number) => void;
  setRestDaysRemaining: (v: number) => void;
  setHasActivePartnerships: (v: boolean) => void;
  setUnreadNotifications: (v: number) => void;
  setDaysLeft: (v: number | null) => void;
  setGender: (g: string | null) => void;
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
    own_access_tier?: AccessTier | null;
    player_view_tier?: AccessTier | null;
    shop_freeze_balance?: number;
    gift_freeze_balance?: number;
    streak_freeze_balance?: number;
    rest_days_remaining?: number;
    has_active_partnerships?: boolean;
    days_left?: number | null;
    unread_notifications?: number;
    gender?: string | null;
  }) => void;
  setPhotoUrl: (url: string) => void;
  setStyledPhotos: (darkUrl: string | null, lightUrl: string | null) => void;
  setPlayerCode: (code: string | null) => void;
  addRole: (role: 'player' | 'responsible') => void;
  clearAuth: () => void;
}

const _parseTier = (raw: string | null): AccessTier | null => {
  if (raw === 'standard' || raw === 'premium' || raw === 'elite') return raw;
  return null;
};

export const useAuthStore = create<AuthState>((set, get) => ({
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
  maintenanceMode: false,
  banInfo: null,
  onboardingBlocked: false,
  onboardingBlockedMessage: null,
  ownAccessTier: _parseTier(localStorage.getItem(CACHE_KEYS.ownTier)),
  playerViewTier: _parseTier(localStorage.getItem(CACHE_KEYS.playerTier)),
  shopFreezeBalance: 0,
  giftFreezeBalance: 0,
  streakFreezeBalance: Number(localStorage.getItem(CACHE_KEYS.streakFreeze) ?? 0),
  restDaysRemaining: 0,
  hasActivePartnerships: false,
  unreadNotifications: Number(localStorage.getItem(CACHE_KEYS.unreadNotifs) ?? 0),
  daysLeft: null,
  gender: localStorage.getItem(CACHE_KEYS.gender),
  effectiveTier: () => {
    const s = get();
    return s.activeRoleView === 'player' ? s.playerViewTier : s.ownAccessTier;
  },
  setActiveRoleView: (view) => set({ activeRoleView: view }),
  setMaintenanceMode: (on) => set({ maintenanceMode: on }),
  setBanInfo: (info) => set({ banInfo: info }),
  setOnboardingBlocked: (message) =>
    set({
      onboardingBlocked: message !== null,
      onboardingBlockedMessage: message,
    }),
  setOwnAccessTier: (tier) => {
    if (tier) localStorage.setItem(CACHE_KEYS.ownTier, tier);
    else localStorage.removeItem(CACHE_KEYS.ownTier);
    set({ ownAccessTier: tier });
  },
  setPlayerViewTier: (tier) => {
    if (tier) localStorage.setItem(CACHE_KEYS.playerTier, tier);
    else localStorage.removeItem(CACHE_KEYS.playerTier);
    set({ playerViewTier: tier });
  },
  setShopFreezeBalance: (v) => set({ shopFreezeBalance: v }),
  setGiftFreezeBalance: (v) => set({ giftFreezeBalance: v }),
  setStreakFreezeBalance: (v) => {
    localStorage.setItem(CACHE_KEYS.streakFreeze, String(v));
    set({ streakFreezeBalance: v });
  },
  setRestDaysRemaining: (v) => set({ restDaysRemaining: v }),
  setHasActivePartnerships: (v) => set({ hasActivePartnerships: v }),
  setUnreadNotifications: (v) => {
    localStorage.setItem(CACHE_KEYS.unreadNotifs, String(v));
    set({ unreadNotifications: v });
  },
  setDaysLeft: (v) => set({ daysLeft: v }),
  setGender: (g) => {
    if (g) localStorage.setItem(CACHE_KEYS.gender, g);
    else localStorage.removeItem(CACHE_KEYS.gender);
    set({ gender: g });
  },
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
    const ownTier = data.own_access_tier ?? null;
    if (ownTier) localStorage.setItem(CACHE_KEYS.ownTier, ownTier);
    else localStorage.removeItem(CACHE_KEYS.ownTier);
    const playerTier = data.player_view_tier ?? null;
    if (playerTier) localStorage.setItem(CACHE_KEYS.playerTier, playerTier);
    else localStorage.removeItem(CACHE_KEYS.playerTier);
    const streakFreeze = data.streak_freeze_balance ?? 0;
    localStorage.setItem(CACHE_KEYS.streakFreeze, String(streakFreeze));
    const unread = data.unread_notifications ?? 0;
    localStorage.setItem(CACHE_KEYS.unreadNotifs, String(unread));
    const gender = data.gender ?? null;
    if (gender) localStorage.setItem(CACHE_KEYS.gender, gender);
    else localStorage.removeItem(CACHE_KEYS.gender);
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
      ownAccessTier: ownTier,
      playerViewTier: playerTier,
      shopFreezeBalance: data.shop_freeze_balance ?? 0,
      giftFreezeBalance: data.gift_freeze_balance ?? 0,
      streakFreezeBalance: streakFreeze,
      restDaysRemaining: data.rest_days_remaining ?? 0,
      hasActivePartnerships: data.has_active_partnerships ?? false,
      daysLeft: data.days_left ?? null,
      unreadNotifications: unread,
      gender,
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
    localStorage.removeItem(CACHE_KEYS.ownTier);
    localStorage.removeItem(CACHE_KEYS.playerTier);
    localStorage.removeItem(CACHE_KEYS.streakFreeze);
    localStorage.removeItem(CACHE_KEYS.unreadNotifs);
    localStorage.removeItem(CACHE_KEYS.gender);
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
      maintenanceMode: false,
      banInfo: null,
      ownAccessTier: null,
      playerViewTier: null,
      shopFreezeBalance: 0,
      giftFreezeBalance: 0,
      streakFreezeBalance: 0,
      restDaysRemaining: 0,
      hasActivePartnerships: false,
      unreadNotifications: 0,
      daysLeft: null,
      gender: null,
    });
  },
}));
