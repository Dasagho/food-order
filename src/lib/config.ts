/** URL base del backend (sin barra final). Vacía = mismo origen. */
export const API_URL: string = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");

/** Permite el acceso de desarrollo (POST /v1/auth/dev-login). Solo para pruebas. */
export const DEV_LOGIN_ENABLED: boolean = import.meta.env.VITE_DEV_LOGIN === "1";

export const REQUEST_TIMEOUT_MS = 10_000;
export const UPLOAD_TIMEOUT_MS = 30_000;

export const apiUrl = (path: string) => `${API_URL}${path}`;

/**
 * Las imágenes subidas devuelven una ruta del backend (`/v1/uploads/x.jpg`).
 * Si el frontend y la API viven en orígenes distintos hay que anteponer la base.
 * Las rutas del propio despliegue (`/paella.jpg`) y las URL absolutas se dejan tal cual.
 */
export function imgSrc(url: string | null | undefined): string {
  if (!url) return "/placeholder.svg";
  if (url.startsWith("/v1/")) return apiUrl(url);
  return url;
}

/** Cifras del árabe: true = ٠١٢٣ (por defecto), false = 0123. Se fija al compilar (VITE_ARABIC_DIGITS=0). */
export const ARABIC_DIGITS: boolean = import.meta.env.VITE_ARABIC_DIGITS !== "0";
