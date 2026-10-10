/**
 * Utilidades de fechas. Regla de oro:
 *  - Un PEDIDO se guarda con el instante real (`new Date()`), que es absoluto.
 *  - El día de negocio de ese instante se calcula SIEMPRE en Europe/Madrid.
 *  - Un DÍA DE CALENDARIO (lo que se elige en el selector) es un Date a medianoche
 *    local; se compara con `toLocalDateString`, nunca reconvirtiéndolo a Madrid.
 */

const MADRID = "Europe/Madrid";

/** Instante real en el que se crea un pedido (se muestra después en hora de Madrid). */
export function getOrderTimestamp(): Date {
  return new Date();
}

function ymd(parts: Intl.DateTimeFormatPart[]) {
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { year: Number(get("year")), month: Number(get("month")), day: Number(get("day")) };
}

const madridParts = new Intl.DateTimeFormat("en-US", {
  timeZone: MADRID,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const pad = (n: number) => String(n).padStart(2, "0");

/** Día (YYYY-MM-DD) en hora de Madrid de un instante dado. */
export function toMadridDateString(date: Date): string {
  const { year, month, day } = ymd(madridParts.formatToParts(date));
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Día (YYYY-MM-DD) de un día de calendario (Date a medianoche local), p. ej. el del selector. */
export function toLocalDateString(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Formatea un instante para la UI en hora de Madrid. */
export function formatMadridDate(
  date: Date,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: MADRID,
    ...options,
  }).format(date);
}

/** Formatea un día de calendario (Date a medianoche local) sin desplazamientos de zona. */
export function formatCalendarDate(
  date: Date,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat("es-ES", options).format(date);
}

/** Compara si dos instantes caen en el mismo día de Madrid. */
export function isSameMadridDay(date1: Date, date2: Date): boolean {
  return toMadridDateString(date1) === toMadridDateString(date2);
}

/** Hoy (a medianoche local) según el calendario de Madrid. */
export function getTodayInMadrid(): Date {
  const { year, month, day } = ymd(madridParts.formatToParts(new Date()));
  return new Date(year, month - 1, day);
}
