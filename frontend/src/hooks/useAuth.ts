import { useEffect, useState } from 'react';
import { retrieveLaunchParams } from '@telegram-apps/sdk-react';
import api, { setToken } from '../api/client';
import { useAuthStore } from '../stores/authStore';

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
        // Get initData from Telegram WebApp
        let initData: string | undefined;

        try {
          const launchParams = retrieveLaunchParams();
          initData = launchParams.initDataRaw as string | undefined;
        } catch {
          // Fallback for dev: check window.Telegram
          initData = window.Telegram?.WebApp?.initData;
        }

        if (!initData) {
          // Dev mode — skip auth
          if (import.meta.env.DEV) {
            setAuth('dev-token', 'player', false);
            setToken('dev-token');
            setIsLoading(false);
            return;
          }
          throw new Error('Для работы приложения откройте его в мобильном Telegram');
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

    authenticate();
    return () => { cancelled = true; };
  }, [isAuthenticated, setAuth]);

  return { isLoading, isAuthenticated, role, onboardingDone, error, clearAuth };
}
