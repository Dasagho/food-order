import { useState } from "react";
import { NavLink, Outlet, useMatch } from "react-router-dom";
import { useI18n } from "@/i18n";
import { useOutboxState } from "@/lib/sync/use-outbox";
import { useOnline } from "@/state/use-online";
import { useCatalog } from "@/state/catalog";
import { PendingDialog } from "@/features/sync/pending-dialog";
import { ReviewNote } from "./review-note";
import { LangButton } from "./lang-button";
import { useToast } from "@/ui/toast";

/** Cabecera fija (pestañas, estado de conexión, idioma), barra de avisos y zona principal. */
export function Shell() {
  const { t, num, plural } = useI18n();
  const online = useOnline();
  const q = useOutboxState();
  const catalog = useCatalog();
  const isCaja = useMatch("/");
  const [showPending, setShowPending] = useState(false);

  const short = !online
    ? q.pending
      ? t("Sin conexión · {n} sin enviar", { n: num(q.pending) })
      : t("Sin conexión")
    : q.pending
      ? t("{n} sin enviar", { n: num(q.pending) })
      : "";

  return (
    <>
      <header className="top">
        <div className="top-in">
          <nav className="tabs" aria-label={t("Secciones")}>
            <NavLink className="tab" to="/" end>
              {t("Caja")}
            </NavLink>
            <NavLink className="tab" to="/ventas">
              {t("Ventas")}
            </NavLink>
            <NavLink className="tab" to="/menu">
              {t("Menú")}
            </NavLink>
          </nav>
          {/* región viva siempre presente (el texto cambia, el contenedor no) + botón visible */}
          <span className="sr-only" role="status" aria-live="polite">
            {short}
          </span>
          {short && (
            <button
              type="button"
              className={`net ${!online ? "warn" : ""}`}
              onClick={() => setShowPending(true)}
              aria-haspopup="dialog"
            >
              {short}
            </button>
          )}
          <LangButton />
        </div>
      </header>
      <div className="syncbar">
        {!online && (
          <div className="notice warn">
            <span>{t("Sin conexión. Los pedidos se guardan en este equipo y se envían solos cuando vuelva internet.")}</span>
          </div>
        )}
        {online && q.pending > 0 && !q.authRequired && (
          <div className="notice info">
            <span>{t("Enviando {n}…", { n: plural(q.pending, "pedido") })}</span>
            <button className="btn plain small" type="button" onClick={() => setShowPending(true)}>
              {t("Ver")}
            </button>
          </div>
        )}
        {q.failed > 0 && (
          <div className="notice danger" role="alert">
            <span>{t("{n} sin enviar por un error. Revísalos.", { n: plural(q.failed, "pedido") })}</span>
            <button className="btn plain small" type="button" onClick={() => setShowPending(true)}>
              {t("Ver")}
            </button>
          </div>
        )}
        <ReviewNote />
      </div>
      <main id="view" tabIndex={-1} className={isCaja && catalog.status === "ok" ? "has-bar" : undefined}>
        <Outlet />
      </main>
      {showPending && <PendingDialog onClose={() => setShowPending(false)} />}
    </>
  );
}
