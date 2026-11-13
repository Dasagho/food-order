import { Component, type ErrorInfo, type ReactNode } from "react";
import { useI18n } from "@/i18n";

function Fallback() {
  const { t } = useI18n();
  return (
    <main role="alert" className="state">
      <h1>{t("Algo ha fallado al cargar esta pantalla")}</h1>
      <p className="soft">{t("Puede ser un problema de conexión. Tus pedidos pendientes no se pierden.")}</p>
      <button className="btn primary big" type="button" onClick={() => window.location.reload()}>
        {t("Recargar")}
      </button>
    </main>
  );
}

interface State {
  error: Error | null;
}

/** Captura fallos de carga de las rutas diferidas (p. ej. sin red tras una actualización). */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    return this.state.error ? <Fallback /> : this.props.children;
  }
}
