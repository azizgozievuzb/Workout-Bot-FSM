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
    if (err.response?.status === 403 && (code === 'NO_ACCESS' || code === 'PROMO_EXPIRED')) {
      setToken(null);
      useAuthStore.getState().setAccessRevoked(true);
    }
    return Promise.reject(err);
  }
);

export default api;
