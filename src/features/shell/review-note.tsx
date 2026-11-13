import { useState } from "react";
import { useI18n } from "@/i18n";

/** Aviso en árabe: las traducciones están pendientes de revisión por un hablante nativo (SPEC §1). */
export function ReviewNote() {
  const { t, lang } = useI18n();
  const [hidden, setHidden] = useState(false);
  if (lang !== "ar" || hidden) return null;
  return (
    <div className="notice info review-note" role="note">
      <span>{t("Las traducciones al árabe están pendientes de revisión por un hablante nativo.")}</span>
      <button className="btn plain small" type="button" onClick={() => setHidden(true)}>
        {t("Vale")}
      </button>
    </div>
  );
}
