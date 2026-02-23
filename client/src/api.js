/**
 * Backend API base URL. Empty string = use relative URLs (Vite proxy in dev).
 * Set VITE_API_ORIGIN for production (e.g. https://your-api.com).
 */
export const API_ORIGIN =
  import.meta.env.VITE_API_ORIGIN != null && import.meta.env.VITE_API_ORIGIN !== ''
    ? String(import.meta.env.VITE_API_ORIGIN).replace(/\/$/, '')
    : '';

export function apiUrl(path) {
  const p = path.startsWith('/') ? path : `/${path}`;
  return API_ORIGIN ? `${API_ORIGIN}${p}` : p;
}
