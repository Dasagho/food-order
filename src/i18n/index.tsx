import { useEffect, useSyncExternalStore } from "react";
import {
  LANGS,
  dn,
  getDir,
  getLang,
  getLocale,
  getVersion,
  loadStoredLang,
  money,
  num,
  plural,
  setLang,
  subscribe,
  t,
} from "./core";

export * from "./core";

/** Hook: re-renderiza al cambiar el idioma y entrega las funciones de formato. */
export function useI18n() {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  return { lang: getLang(), dir: getDir(), locale: getLocale(), langs: LANGS, t, num, money, plural, dn, setLang };
}

/** Carga la preferencia guardada (IndexedDB) una vez al montar la aplicación. */
export function useLoadStoredLang() {
  useEffect(() => {
    void loadStoredLang();
  }, []);
}
