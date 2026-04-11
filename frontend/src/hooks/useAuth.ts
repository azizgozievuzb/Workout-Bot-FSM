import { useEffect, useState } from 'react';
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
  const { isAuthenticated, role, onboardingDone, setAuth, clearAuth } = useAuthStore();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
            setAuth('dev-token', 'player', false);
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
          setAuth(data.access_token, data.role, data.onboarding_done);
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || 'Authentication failed');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    // Small delay to ensure Telegram WebApp is fully initialized
    setTimeout(authenticate, 100);

    return () => { cancelled = true; };
  }, [isAuthenticated, setAuth]);

  return { isLoading, isAuthenticated, role, onboardingDone, error, clearAuth };
}
