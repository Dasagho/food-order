import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/lib/auth/auth-context";
import { AuthGate } from "@/features/auth/login-page";
import { ErrorBoundary } from "@/features/shell/error-boundary";
import { Shell } from "@/features/shell/shell";
import { SyncBootstrap } from "@/features/sync/sync-bootstrap";
import { CatalogProvider } from "@/state/catalog";
import { TicketProvider } from "@/state/ticket";
import { ConfirmProvider } from "@/ui/confirm";
import { ToastProvider } from "@/ui/toast";
import { useLoadStoredLang } from "@/i18n";

// Pantallas secundarias: se descargan al entrar (el service worker las precachea al instalar,
// así que también funcionan sin conexión). La Caja va en el paquete principal.
import CajaPage from "@/features/caja/caja-page";
const VentasPage = lazy(() => import("@/features/ventas/ventas-page"));
const MenuPage = lazy(() => import("@/features/menu/menu-page"));

export function App() {
  useLoadStoredLang(); // preferencia de idioma guardada en IndexedDB (no en el almacenamiento web)
  return (
    <ToastProvider>
      <ConfirmProvider>
        <AuthProvider>
          <AuthGate>
            <SyncBootstrap />
            <CatalogProvider>
              <TicketProvider>
                <ErrorBoundary>
                  <Suspense fallback={<div aria-busy="true" />}>
                    <Routes>
                      <Route element={<Shell />}>
                        <Route path="/" element={<CajaPage />} />
                        <Route path="/ventas" element={<VentasPage />} />
                        <Route path="/menu" element={<MenuPage />} />
                        {/* rutas de la versión anterior */}
                        <Route path="/pedidos" element={<Navigate to="/ventas" replace />} />
                        <Route path="/admin" element={<Navigate to="/menu" replace />} />
                        <Route path="*" element={<Navigate to="/" replace />} />
                      </Route>
                    </Routes>
                  </Suspense>
                </ErrorBoundary>
              </TicketProvider>
            </CatalogProvider>
          </AuthGate>
        </AuthProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
