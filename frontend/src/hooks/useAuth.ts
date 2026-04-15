import { useEffect, useState, useRef } from 'react';
import { retrieveLaunchParams } from '@telegram-apps/sdk-react';
import api, { setToken } from '../api/client';
import { useAuthStore } from '../stores/authStore';

// Declare Telegram WebApp type
declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        initData: string;
        initDataUnsafe: Record<string, any>;
        ready: () => void;
        expand: () => void;
        platform: string;
      };
    };
  }
}

function getInitData(): string {
  // Method 1: Direct from Telegram WebApp object (loaded via script in index.html)
  const tgData = window.Telegram?.WebApp?.initData;
  if (tgData && tgData.length > 0) {
    return tgData;
  }

  // Method 2: From @telegram-apps/sdk (parses URL hash)
  try {
    const lp = retrieveLaunchParams();
    const raw = lp.initDataRaw;
    if (raw && typeof raw === 'string' && raw.length > 0) {
      return raw;
    }
  } catch {
    // SDK couldn't parse launch params
  }

  return '';
}

export function useAuth() {
  const {
    isAuthenticated, role, primary_role, has_player_access, has_responsible_access, is_admin,
    onboardingDone, photoUrl, photoDarkUrl, photoLightUrl, setAuth, setStyledPhotos, clearAuth,
  } = useAuthStore();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isAuthenticated) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;

    const authenticate = async () => {
      try {
        // Signal Telegram that app is ready
        if (window.Telegram?.WebApp) {
          window.Telegram.WebApp.ready();
          window.Telegram.WebApp.expand();
        }

        const initData = getInitData();

        if (!initData) {
          if (import.meta.env.DEV) {
            setAuth({ token: 'dev-token', role: 'player', onboardingDone: false });
            setToken('dev-token');
            setIsLoading(false);
            return;
          }
          // Show debug info in production to help diagnose
          const platform = window.Telegram?.WebApp?.platform || 'unknown';
          const hasTg = !!window.Telegram?.WebApp;
          throw new Error(
            `Не удалось получить данные авторизации.\n` +
            `Platform: ${platform}, WebApp: ${hasTg}`
          );
        }

        const { data } = await api.post('/auth/telegram', { init_data: initData });

        if (!cancelled) {
          setToken(data.access_token);
          setAuth({
            token: data.access_token,
            role: data.role,
            primary_role: data.primary_role,
            has_player_access: data.has_player_access,
            has_responsible_access: data.has_responsible_access,
            is_admin: data.is_admin,
            onboardingDone: data.onboarding_done,
            photoUrl: data.profile_photo_url,
            photoDarkUrl: data.photo_dark_url,
            photoLightUrl: data.photo_light_url,
          });
        }
      } catch (err: any) {
        if (!cancelled) {
          if ((err as any).__accessRevoked) return; // handled by interceptor; black screen shown

          // 403 NO_ACCESS — пользователь не в БД → авто-регистрация
          const code = err.response?.data?.detail?.code ?? err.response?.data?.detail;
          if (err.response?.status === 403 && code === 'NO_ACCESS') {
            try {
              const initData = getInitData();
              const { data } = await api.post('/auth/register', { init_data: initData });
              if (!cancelled) {
                setToken(data.access_token);
                setAuth({
                  token: data.access_token,
                  role: data.role,
                  primary_role: data.primary_role,
                  has_player_access: data.has_player_access ?? false,
                  has_responsible_access: data.has_responsible_access ?? false,
                  is_admin: data.is_admin ?? false,
                  onboardingDone: data.onboarding_done,
                  photoUrl: data.profile_photo_url,
                  photoDarkUrl: data.photo_dark_url,
                  photoLightUrl: data.photo_light_url,
                });
              }
            } catch (regErr: any) {
              if (!cancelled) setError(regErr.message || 'Registration failed');
            }
            return;
          }

          setError(err.message || 'Authentication failed');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    const waitForTelegram = (retries = 5, delay = 50) => {
      const initData = getInitData();
      if (initData || retries <= 0) {
        authenticate();
        return;
      }
      setTimeout(() => waitForTelegram(retries - 1, delay), delay);
    };
    waitForTelegram();

    return () => { cancelled = true; };
  }, [isAuthenticated, setAuth]);

  // Poll for styled photos if original exists but styled don't
  useEffect(() => {
    if (!isAuthenticated || !photoUrl || (photoDarkUrl && photoLightUrl)) {
      return;
    }

    const poll = async () => {
      try {
        const { data } = await api.get('/users/me/photo-status');
        if (data.photo_dark_url && data.photo_light_url) {
          setStyledPhotos(data.photo_dark_url, data.photo_light_url);
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
        }
      } catch {
        // silent — retry on next interval
      }
    };

    pollingRef.current = setInterval(poll, 5000);
    // Also run immediately
    poll();

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [isAuthenticated, photoUrl, photoDarkUrl, photoLightUrl, setStyledPhotos]);

  return {
    isLoading, isAuthenticated, role, primary_role,
    has_player_access, has_responsible_access, is_admin,
    onboardingDone, photoUrl, photoDarkUrl, photoLightUrl, error, clearAuth,
  };
}
