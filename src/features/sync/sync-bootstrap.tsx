import { useEffect } from "react";
import { useToast } from "@/ui/toast";
import { t } from "@/i18n/core";
import { startSync } from "@/lib/sync/bootstrap";
import { subscribe } from "@/lib/sync/outbox";

/** Arranca la sincronización (cola, catálogo, importación) y traduce sus eventos a avisos. */
export function SyncBootstrap() {
  const { toast } = useToast();

  useEffect(() => {
    const stop = startSync((r) => {
      if (r.status === "done")
        toast(t("Datos antiguos importados al servidor: {o} pedidos, {p} productos.", { o: r.orders, p: r.products }), "ok");
      else if (r.status === "partial")
        toast(t("{n} pedidos antiguos no se pudieron importar. Se conservan en este dispositivo y se reintentará.", { n: r.remaining }), "error");
      else if (r.status === "failed")
        toast(t("No se pudieron importar los datos antiguos todavía. Se conservan y se reintentará."), "error");
    });
    const off = subscribe((e) => {
      if (e.type === "conflict")
        toast(t("Un cambio hecho sin conexión se descartó: el pedido {n} cambió en otro sitio.", { n: `…${e.orderId.slice(-4)}` }), "error");
      if (e.type === "failed") toast(t("Un pedido no se pudo enviar. Mira el aviso rojo."), "error");
    });
    return () => {
      off();
      stop();
    };
  }, [toast]);
  return null;
}
