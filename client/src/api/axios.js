import axios from 'axios';
import { useAuth } from '../store/auth.js';

/** Axios instance for /api — attaches JWT, handles 401 → auto-logout. */
const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use((config) => {
  const token = useAuth.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401 && useAuth.getState().token) {
      useAuth.getState().logout();
    }
    return Promise.reject(err);
  }
);

export const errMsg = (err, fallback = 'Something went wrong') =>
  err?.response?.data?.message || err?.message || fallback;

export default api;
