import { useI18n, type Lang } from "@/i18n";

/**
 * Selector de idioma: botón que nombra el idioma al que se cambia (en ese idioma, con su `lang`
 * para que el lector de pantalla lo pronuncie bien) y el cambio se guarda en IndexedDB.
 */
export function LangButton() {
  const { lang, langs, setLang } = useI18n();
  const other: Lang = lang === "es" ? "ar" : "es";
  return (
    <button
      className="btn plain small lang"
      type="button"
      lang={langs[other].htmlLang}
      aria-label={other === "ar" ? "العربية — تغيير اللغة" : "Español — cambiar idioma"}
      onClick={() => setLang(other)}
    >
      {langs[other].label}
    </button>
  );
}
