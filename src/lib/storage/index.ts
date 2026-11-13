import type { Backend } from "./types";
import { createIndexedDbBackend } from "./indexeddb-backend";
import { createLocalStorageBackend } from "./localstorage-backend";

let backendPromise: Promise<Backend> | null = null;

/**
 * Devuelve el backend de persistencia (singleton). La primera llamada abre
 * IndexedDB y migra de forma automática y silenciosa los datos existentes de
 * localStorage. Si IndexedDB no está disponible, se usa localStorage como antes.
 */
export function getBackend(): Promise<Backend> {
  if (!backendPromise) {
    backendPromise = (async () => {
      try {
        if (typeof indexedDB === "undefined") throw new Error("sin IndexedDB");
        const backend = await createIndexedDbBackend();
        // Pedir almacenamiento persistente para que el navegador no lo desaloje
        navigator.storage?.persist?.().catch(() => {});
        return backend;
      } catch (e) {
        console.error("[storage] IndexedDB no disponible, usando localStorage", e);
        return createLocalStorageBackend();
      }
    })();
  }
  return backendPromise;
}
