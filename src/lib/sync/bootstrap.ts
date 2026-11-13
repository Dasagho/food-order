import { importLegacyData, type LegacyImportResult } from "@/lib/legacy/legacy-import";
import { refreshCatalog, startCatalogSync } from "@/lib/product-storage";
import * as outbox from "./outbox";

/**
 * Tareas de sincronización tras iniciar sesión:
 *  1. importación única de los datos antiguos (si los hay);
 *  2. cola de salida (reanuda al volver la conexión);
 *  3. catálogo: refresco al arrancar y cada 5 min.
 * Devuelve la función que las detiene.
 */
export function startSync(onLegacy?: (r: LegacyImportResult) => void): () => void {
  let stopped = false;
  outbox.start();

  const legacy = async () => {
    const r = await importLegacyData();
    if (stopped) return;
    if (r.status !== "skipped") onLegacy?.(r);
    if (r.status === "done" || r.status === "partial") await refreshCatalog().catch(() => {});
  };
  void legacy();
  // Si la importación no pudo completarse (sin red…), se reintenta al volver la conexión
  const onOnline = () => void legacy();
  window.addEventListener("online", onOnline);

  const stopCatalog = startCatalogSync();
  return () => {
    stopped = true;
    window.removeEventListener("online", onOnline);
    stopCatalog();
  };
}
