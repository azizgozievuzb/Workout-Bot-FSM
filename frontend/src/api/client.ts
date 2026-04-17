import axios from 'axios';
import { useAuthStore } from '../stores/authStore';

let token: string | null = null;

export const setToken = (t: string | null) => { token = t; };
export const getToken = () => token;

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000',
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const t = getToken();
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      setToken(null);
    }
    const detail = err.response?.data?.detail;
    const code = typeof detail === 'object' ? detail?.code : detail;
    // NO_ACCESS — пользователь не в БД, нужна регистрация через /auth/register
    // НЕ ставим accessRevoked, пробрасываем как есть для useAuth
    if (err.response?.status === 403 && code === 'NO_ACCESS') {
      return Promise.reject(err);
    }
    // PROMO_EXPIRED — доступ был, но истёк → чёрный экран
    if (err.response?.status === 403 && code === 'PROMO_EXPIRED') {
      setToken(null);
      useAuthStore.getState().setAccessRevoked(true);
      const sentinel = new Error('ACCESS_REVOKED');
      (sentinel as any).__accessRevoked = true;
      return Promise.reject(sentinel);
    }
    // BANNED — пользователь или его Ответственный забанен
    if (err.response?.status === 403 && typeof detail === 'object' && detail?.code === 'BANNED') {
      useAuthStore.getState().setBanInfo({
        until: detail.ban_until,
        reason: detail.reason ?? '',
        missed: detail.missed_workouts ?? 0,
      });
      return Promise.reject(err);
    }
    // MAINTENANCE — техработы
    if (err.response?.status === 503 && typeof detail === 'object' && detail?.code === 'MAINTENANCE') {
      useAuthStore.getState().setMaintenanceMode(true);
      return Promise.reject(err);
    }
    return Promise.reject(err);
  }
);

export default api;
