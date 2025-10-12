/**
 * Utilidades para manejar fechas en zona horaria Europe/Madrid
 */

/**
 * Obtiene la fecha actual en zona horaria de Madrid
 */
export function getMadridDate(): Date {
  return new Date(
    new Date().toLocaleString("en-US", {
      timeZone: "Europe/Madrid",
    }),
  );
}

/**
 * Convierte una fecha a string en formato YYYY-MM-DD en zona horaria de Madrid
 */
export function toMadridDateString(date: Date): string {
  const madridDate = new Date(
    date.toLocaleString("en-US", {
      timeZone: "Europe/Madrid",
    }),
  );
  const year = madridDate.getFullYear();
  const month = String(madridDate.getMonth() + 1).padStart(2, "0");
  const day = String(madridDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Formatea una fecha para mostrar en la UI en zona horaria de Madrid
 */
export function formatMadridDate(
  date: Date,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat("es-ES", {
    timeZone: "Europe/Madrid",
    ...options,
  }).format(date);
}

/**
 * Compara si dos fechas son del mismo día en zona horaria de Madrid
 */
export function isSameMadridDay(date1: Date, date2: Date): boolean {
  return toMadridDateString(date1) === toMadridDateString(date2);
}

/**
 * Obtiene la fecha de hoy (sin hora) en zona horaria de Madrid
 */
export function getTodayInMadrid(): Date {
  const madridDate = getMadridDate();
  madridDate.setHours(0, 0, 0, 0);
  return madridDate;
}
