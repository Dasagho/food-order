import { useEffect, useState } from "react";
import { getState, subscribe, type OutboxEvent, type OutboxState } from "./outbox";

const EMPTY: OutboxState = { pending: 0, failed: 0, authRequired: false, retryAt: null };

/** Estado de la cola de salida para la interfaz (se actualiza con cada cambio). */
export function useOutboxState(): OutboxState {
  const [state, setState] = useState<OutboxState>(EMPTY);
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      getState()
        .then((s) => alive && setState(s))
        .catch(() => {});
    refresh();
    const off = subscribe((e) => e.type !== "failed" && refresh());
    return () => {
      alive = false;
      off();
    };
  }, []);
  return state;
}

/** Ejecuta `fn` cuando el servidor confirma operaciones o hay un conflicto (recargar vistas). */
export function useOutboxEvents(fn: (e: OutboxEvent) => void) {
  useEffect(() => subscribe(fn), [fn]);
}
