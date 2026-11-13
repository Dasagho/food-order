/**
 * Localización. Idioma base: español (es-ES). Añadido: árabe de Egipto (ar-EG, de derecha a izquierda).
 * Las claves son los propios textos en español; si falta una traducción se muestra el español.
 *
 * La preferencia de idioma se guarda en IndexedDB (almacén `meta`, clave `lang`), nunca en el
 * almacenamiento web del navegador (el prototipo usaba otra clave allí y NO se copia).
 */
import { getMeta, setMeta } from "@/lib/db";
import { ARABIC_DIGITS } from "@/lib/config";
import { AR } from "./ar";

export type Lang = "es" | "ar";

export const LANGS: Record<Lang, { locale: string; dir: "ltr" | "rtl"; label: string; htmlLang: string }> = {
  es: { locale: "es-ES", dir: "ltr", label: "Español", htmlLang: "es" },
  ar: { locale: "ar-EG", dir: "rtl", label: "العربية", htmlLang: "ar-EG" },
};

export const META_LANG_KEY = "lang";

let lang: Lang = detect();
let version = 0;
const listeners = new Set<() => void>();

function detect(): Lang {
  try {
    const q = new URLSearchParams(globalThis.location?.search ?? "").get("lang");
    if (q === "es" || q === "ar") return q;
  } catch {
    /* sin location */
  }
  return (globalThis.navigator?.language ?? "es").toLowerCase().startsWith("ar") ? "ar" : "es";
}

const fill = (s: string, p?: Record<string, string | number>) =>
  p ? s.replace(/\{(\w+)\}/g, (m, k) => (p[k] !== undefined ? String(p[k]) : m)) : s;

export const getLang = () => lang;
export const getDir = () => LANGS[lang].dir;
export const getVersion = () => version;

/** Configuración regional con las cifras de la configuración (ar-EG: ٠١٢ por defecto, o 0123). */
export const getLocale = () => (lang === "ar" && !ARABIC_DIGITS ? "ar-EG-u-nu-latn" : LANGS[lang].locale);

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const t = (key: string, params?: Record<string, string | number>): string =>
  fill((lang !== "es" && AR.strings[key]) || key, params);

export const num = (n: number): string => new Intl.NumberFormat(getLocale()).format(n);

export const money = (n: number | null | undefined): string =>
  new Intl.NumberFormat(getLocale(), { style: "currency", currency: "EUR" }).format(Math.round((n || 0) * 100) / 100);

/**
 * Plural: noun = clave de AR.plurals. es: [uno, varios]; ar: [uno, dos, 3-10, 11+] con {n}.
 * Sin entrada para el sustantivo se usa «<n> <noun>» (español: añade «s»).
 */
export function plural(n: number, noun: string, esForms?: [string, string]): string {
  if (lang === "ar") {
    const f = AR.plurals[noun];
    if (!f) return `${num(n)} ${noun}`;
    const form = n === 1 ? f[0] : n === 2 ? f[1] : n % 100 >= 3 && n % 100 <= 10 ? f[2] : f[3];
    return fill(form, { n: num(n) });
  }
  const f = esForms ?? [noun, `${noun}s`];
  return `${num(n)} ${n === 1 ? f[0] : f[1]}`;
}

/** Nombre traducible de un dato (producto, sección, línea de pedido): names[lang] || name. */
export const dn = (o: { name: string; names?: { ar?: string } } | null | undefined): string =>
  (o && lang === "ar" && o.names?.ar) || o?.name || "";

function applyToDocument() {
  if (typeof document === "undefined") return;
  const h = document.documentElement;
  h.lang = LANGS[lang].htmlLang;
  h.dir = LANGS[lang].dir;
  document.title = t("Caja · Casa de comidas");
}

/** Cambia el idioma, re-renderiza y (opcionalmente) lo guarda en IndexedDB. */
export function setLang(code: Lang, opts: { persist?: boolean } = {}): void {
  lang = code === "ar" ? "ar" : "es";
  version++;
  applyToDocument();
  listeners.forEach((l) => l());
  if (opts.persist !== false) void setMeta(META_LANG_KEY, lang).catch(() => {});
}

/**
 * Al arrancar: `?lang=` manda; si no, la preferencia guardada en IndexedDB; si no, el idioma del navegador.
 */
export async function loadStoredLang(): Promise<void> {
  try {
    const q = new URLSearchParams(globalThis.location?.search ?? "").get("lang");
    if (q === "es" || q === "ar") return setLang(q, { persist: false });
    const stored = await getMeta<string>(META_LANG_KEY);
    if (stored === "es" || stored === "ar") setLang(stored, { persist: false });
    else applyToDocument();
  } catch {
    applyToDocument();
  }
}

/** Solo para tests. */
export function _resetLang() {
  lang = detect();
  version++;
}
applyToDocument();
