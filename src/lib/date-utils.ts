/**
 * Utilidades de fechas. Regla de oro:
 *  - Un PEDIDO se guarda con el instante real (`new Date()`), que es absoluto.
 *  - El día de negocio de ese instante se calcula SIEMPRE en Europe/Madrid.
 *  - Un DÍA DE CALENDARIO (lo que se elige en el selector de Ventas) es un texto YYYY-MM-DD;
 *    nunca se reconvierte a Madrid ni se mezcla con zonas horarias.
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

// ───────────── utilidades para pantallas (rediseño) ─────────────
const parts24 = new Intl.DateTimeFormat("en-US", {
  timeZone: MADRID,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function partsAt(ms: number) {
  const o: Record<string, number> = {};
  parts24.formatToParts(new Date(ms)).forEach((p) => {
    if (p.type !== "literal") o[p.type] = Number(p.value);
  });
  return o;
}

/** Hoy (YYYY-MM-DD) según el calendario de Madrid. */
export const todayMadrid = (): string => toMadridDateString(new Date());

/** Suma días a un día YYYY-MM-DD (sin zonas: calendario puro). */
export function shiftDay(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Hora local de Madrid (HH:MM) de un instante. */
export function hhmmMadrid(date: Date): string {
  const p = partsAt(date.getTime());
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** «2026-11-10» + «13:05» en hora de Madrid → ISO UTC (resuelve el cambio de hora de verano). */
export function madridToUtc(day: string, hhmm: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const offsetAt = (ms: number) => {
    const p = partsAt(ms);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
  };
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const off = offsetAt(guess);
  let res = guess - off;
  const off2 = offsetAt(res);
  if (off2 !== off) res = guess - off2;
  return new Date(res).toISOString();
}
