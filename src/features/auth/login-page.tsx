import type { ReactNode } from "react";
import { useI18n } from "@/i18n";
import { useAuth } from "@/lib/auth/auth-context";
import { DEV_LOGIN_ENABLED } from "@/lib/config";
import { useOutboxState } from "@/lib/sync/use-outbox";
import { errorText } from "@/lib/errors";
import { LangButton } from "@/features/shell/lang-button";
import { ReviewNote } from "@/features/shell/review-note";

/** Entrada: toda la app exige sesión. Con la cola pendiente se avisa de que se enviará sola al entrar. */
export function LoginPage() {
  const { t, plural } = useI18n();
  const { loginWithMicrosoft, loginDev, error } = useAuth();
  const q = useOutboxState();
  return (
    <>
      <header className="top">
        <div className="top-in">
          <span style={{ flex: 1 }} />
          <LangButton />
        </div>
      </header>
      <div className="syncbar">
        <ReviewNote />
      </div>
      <main id="view" tabIndex={-1}>
        <div className="login">
          <div>
            <h1>{t("Entrar")}</h1>
            <p className="soft" style={{ marginTop: 8 }}>
              {t("Entra con tu cuenta de Microsoft.")}
            </p>
          </div>
          {q.pending > 0 && (
            <p className="notice info" role="status">
              <span>{t("Hay {n} sin enviar. Se enviarán solos al entrar.", { n: plural(q.pending, "pedido") })}</span>
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {errorText({ code: error })}
            </p>
          )}
          <button className="btn primary big" type="button" onClick={loginWithMicrosoft}>
            {t("Entrar con Microsoft")}
          </button>
          {DEV_LOGIN_ENABLED && (
            <button className="btn plain big" type="button" onClick={loginDev}>
              {t("Entrar sin Microsoft (desarrollo)")}
            </button>
          )}
        </div>
      </main>
    </>
  );
}

/** Muestra la app solo con sesión; si no, la pantalla de entrada (también tras un acceso denegado). */
export function AuthGate({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  if (status === "loading") return <div aria-busy="true" />;
  if (status !== "signedIn") return <LoginPage />;
  return <>{children}</>;
}
