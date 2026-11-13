/** URL base del backend (sin barra final). Vacía = mismo origen. */
export const API_URL: string = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");

/** Permite el acceso de desarrollo (POST /v1/auth/dev-login). Solo para pruebas. */
export const DEV_LOGIN_ENABLED: boolean = import.meta.env.VITE_DEV_LOGIN === "1";

export const REQUEST_TIMEOUT_MS = 10_000;
/** Subida de fotos: hasta 15 MB por una conexión móvil, más el tiempo que tarda el servidor en reducirla. */
export const UPLOAD_TIMEOUT_MS = 90_000;
/** Tamaño máximo de la foto elegida (SPEC §6.6): el servidor la reduce a 800 px y la convierte a WebP. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const MAX_UPLOAD_MB = MAX_UPLOAD_BYTES / (1024 * 1024);

export const apiUrl = (path: string) => `${API_URL}${path}`;

/**
 * `src` de una imagen de producto. Toda ruta que empieza por `/` (`/media/<clave>.webp` de las subidas, o
 * `/paella-valenciana.jpg` de las heredadas) es del ORIGEN DE LA APP: el reverse proxy / nginx enruta /media al
 * bucket (SPEC §6.6), por eso NUNCA se antepone VITE_API_URL (aunque la API viva en otro dominio, las imágenes
 * no). Las URL absolutas externas se dejan tal cual (la CSP decide si se pueden cargar). Solo se aporta la imagen
 * por defecto cuando no hay ninguna.
 */
export function imgSrc(url: string | null | undefined): string {
  return url ? url : "/placeholder.svg";
}

/** Cifras del árabe: true = ٠١٢٣ (por defecto), false = 0123. Se fija al compilar (VITE_ARABIC_DIGITS=0). */
export const ARABIC_DIGITS: boolean = import.meta.env.VITE_ARABIC_DIGITS !== "0";
