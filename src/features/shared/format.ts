import { getLocale, num } from "@/i18n/core";
import type { ConfirmedOrder } from "@/types/order";

/** Número visible de un pedido: el definitivo del servidor o el provisional «P-n» si está pendiente. */
export const numLabel = (o: Pick<ConfirmedOrder, "pending" | "provisionalNumber" | "orderNumber">): string =>
  o.pending ? `P-${o.provisionalNumber ?? "?"}` : num(o.orderNumber);

/** «4,5» / «4.50» → número; vacío → null; ilegible → NaN. Acepta coma y punto. */
export function parseAmount(s: string | number | null | undefined): number | null {
  const x = String(s ?? "").trim().replace(",", ".");
  if (x === "") return null;
  const v = Number(x);
  return Number.isFinite(v) ? v : Number.NaN;
}

/** Importe válido: no negativo y como máximo 2 decimales. */
export const amountOk = (v: number | null): v is number =>
  v !== null && Number.isFinite(v) && v >= 0 && Math.abs(v * 100 - Math.round(v * 100)) < 1e-7;

export const r2 = (n: number) => Math.round(n * 100) / 100;

/** Hora de un instante en hora de Madrid, con el formato del idioma (es: 24 h; ar-EG: cifras y «م/ص» del idioma). */
export const timeStr = (d: Date): string =>
  new Date(d).toLocaleTimeString(getLocale(), { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" });
