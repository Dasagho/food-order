import { ApiError } from "@/lib/api/client";
import { t } from "@/i18n/core";

/**
 * Textos por `code` (el servidor no localiza los mensajes, SPEC §3): se traducen en el cliente y
 * nunca se muestra el `message` del servidor (es español).
 */
export function errorText(e: { code?: string } | null | undefined): string {
  switch (e?.code) {
    case "network_error":
    case "network":
      return t("Sin conexión. Revisa internet.");
    case "timeout":
      return t("El servidor tarda demasiado. Prueba otra vez.");
    case "validation_error":
      return t("Revisa los datos.");
    case "invalid_amount":
      return t("Importe no válido. Usa como máximo 2 decimales.");
    case "unauthorized":
      return t("Sesión caducada. Entra otra vez.");
    case "forbidden":
      return t("No tienes permiso para esto.");
    case "not_found":
      return t("Ya no existe. Recarga la pantalla.");
    case "conflict":
      return t("Hay un conflicto con otro cambio. Recarga e inténtalo otra vez.");
    case "revision_mismatch":
      return t("Este pedido cambió en otro sitio. Se ha recargado.");
    case "category_not_empty":
      return t("La sección tiene platos. Muévelos o bórralos.");
    case "reorder_mismatch":
      return t("El menú cambió en otro sitio. Se ha recargado: repite el cambio.");
    case "number_taken":
      return t("Ese número ya está en uso ese día.");
    case "payload_too_large":
      return t("La foto pesa más de 5 MB.");
    case "unsupported_media_type":
      return t("Solo se admiten fotos JPG, PNG o WebP.");
    case "rate_limited":
      return t("Demasiados intentos. Espera un momento.");
    case "internal_error":
      return t("Fallo del servidor. Prueba otra vez.");
    case "dependent_failed":
    case "dependent":
      return t("Depende de otro cambio que no se pudo enviar.");
    case "insecure_context":
      return t("Para entrar con Microsoft hace falta una conexión segura (https).");
    case "access_denied":
      return t("Esa cuenta no tiene permiso para entrar.");
    case "state_lost":
      return t("Se perdió el inicio de sesión. Prueba otra vez.");
    default:
      return t("No se pudo completar.");
  }
}

export const errorCode = (e: unknown): string | undefined => (e instanceof ApiError ? e.code : undefined);

/** Texto traducido de cualquier error (los que no son de la API: texto genérico). */
export const errorMessage = (e: unknown): string =>
  e instanceof ApiError || (typeof e === "object" && e && "code" in e) ? errorText(e as { code?: string }) : errorText(null);

/** ¿Falta conexión (o el servidor no responde) y no un rechazo real? */
export const isOfflineError = (e: unknown) => e instanceof ApiError && (e.status === 0 || e.status >= 500);
