import { useCallback, useEffect, useRef, useState } from "react";
import { getInProcessOrders } from "@/lib/order-storage";
import { subscribe } from "@/lib/sync/outbox";
import type { ConfirmedOrder } from "@/types/order";

/** Pedidos en proceso (servidor + pendientes locales); se recargan al cambiar la cola de salida. */
export function useInProcess() {
  const [orders, setOrders] = useState<ConfirmedOrder[]>([]);
  const [offline, setOffline] = useState(false);
  const seq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const r = await getInProcessOrders();
      if (mine !== seq.current) return;
      setOrders(r.orders);
      setOffline(r.offline);
    } catch {
      /* se conserva la lista anterior */
    }
  }, []);

  useEffect(() => {
    void reload();
    const off = subscribe((e) => {
      if (e.type === "failed") return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void reload(), 300);
    });
    const onFocus = () => void reload();
    window.addEventListener("online", onFocus);
    return () => {
      off();
      window.removeEventListener("online", onFocus);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [reload]);

  return { orders, offline, reload };
}
