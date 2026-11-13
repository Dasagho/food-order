import { useCallback, useEffect, useState } from "react";
import { Dialog, DialogHead } from "@/ui/dialog";
import { useConfirm } from "@/ui/confirm";
import { useToast } from "@/ui/toast";
import { Empty, PendingChip, StatusChip } from "@/ui/parts";
import { useI18n } from "@/i18n";
import { discardFailed, listFailed, retryFailed, subscribe, type FailedEntry } from "@/lib/sync/outbox";
import { discardPendingOrder, getPendingOrders } from "@/lib/order-storage";
import { errorText } from "@/lib/errors";
import { numLabel, timeStr } from "@/features/shared/format";
import type { ConfirmedOrder } from "@/types/order";
import type { CreateOrderBody } from "@/lib/api";
import { itemsTotal, itemFromWire } from "@/lib/mapping";

/**
 * Lo que no ha llegado al servidor: pedidos pendientes (se pueden DESCARTAR mientras no hayan
 * llegado, SPEC §8.1) y operaciones rechazadas por el servidor (Reintentar / Descartar).
 */
export function PendingDialog({ onClose }: { onClose: () => void }) {
  const { t, money, plural } = useI18n();
  const confirm = useConfirm();
  const { toast } = useToast();
  const [orders, setOrders] = useState<ConfirmedOrder[]>([]);
  const [failed, setFailed] = useState<FailedEntry[]>([]);

  const load = useCallback(async () => {
    const [o, f] = await Promise.all([getPendingOrders(), listFailed()]);
    setOrders(o);
    setFailed(f);
  }, []);
  useEffect(() => {
    void load();
    return subscribe(() => void load());
  }, [load]);

  const discard = async (o: ConfirmedOrder) => {
    const ok = await confirm({
      title: t("¿Descartar el pedido {n}?", { n: numLabel(o) }),
      text: t("Aún no ha llegado al servidor. Se borra de este equipo y no queda rastro. No se puede deshacer."),
      ok: t("Sí, descartar"),
      danger: true,
    });
    if (!ok) return;
    const r = await discardPendingOrder(o);
    if (r.discarded) toast(t("Pedido descartado."), "ok");
    else toast(r.reason === "sending" ? t("Se está enviando ahora. Espera un momento.") : t("Ya se envió: no se puede descartar."), "error");
    await load();
  };

  const failLabel = (f: FailedEntry) =>
    f.kind === "create"
      ? t("Pedido nuevo {n}", { n: f.provisional ? `P-${f.provisional}` : "" })
      : f.kind === "patch"
        ? t("Cambio en el pedido {n}", { n: `…${f.orderId.slice(-4)}` })
        : t("Borrado del pedido {n}", { n: `…${f.orderId.slice(-4)}` });

  const dropFailed = async (f: FailedEntry) => {
    const ok = await confirm({
      title: t("¿Descartar este envío?"),
      text: t("Se perderá este pedido o cambio. No se puede deshacer."),
      ok: t("Sí, descartar"),
      danger: true,
    });
    if (ok) await discardFailed(f.opId);
    await load();
  };

  return (
    <Dialog onClose={onClose}>
      <DialogHead title={t("Sin enviar")}>
        <button className="btn plain small" type="button" onClick={onClose}>
          {t("Cerrar")}
        </button>
      </DialogHead>
      {orders.length === 0 && failed.length === 0 && <Empty title={t("Nada pendiente")} />}
      {orders.length > 0 && (
        <>
          <h3>{t("Esperando para enviarse")}</h3>
          <ul className="sales">
            {orders.map((o) => (
              <li key={o.id} className="pending-order">
                <div>
                  <span className="s-num">{numLabel(o)}</span> · <b>{timeStr(o.date)}</b>{" "}
                  <span className="soft">
                    · {plural(o.items.reduce((s, i) => s + i.quantity, 0), "producto")} · {money(o.total)}
                  </span>{" "}
                  <span className="chips">
                    <PendingChip />
                    <StatusChip status={o.status} />
                  </span>
                </div>
                <button className="btn danger small" type="button" onClick={() => discard(o)}>
                  {t("Descartar")}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {failed.length > 0 && (
        <>
          <h3>{t("Sin enviar por un error")}</h3>
          <ul className="sales">
            {failed.map((f) => (
              <li key={f.opId} className="failrow">
                <div>
                  <b>{failLabel(f)}</b>
                  {f.kind === "create" && (
                    <span className="soft">
                      {" "}
                      · {timeStr(new Date((f.payload as CreateOrderBody).createdAt))} ·{" "}
                      {money(itemsTotal((f.payload as CreateOrderBody).items.map((i) => itemFromWire({ ...i, listPrice: i.listPrice ?? null }))))}
                    </span>
                  )}
                  <div className="error">{errorText(f.error)}</div>
                </div>
                <div className="failbtns">
                  <button className="btn primary small" type="button" onClick={() => retryFailed(f.opId).then(load)}>
                    {t("Reintentar")}
                  </button>
                  <button className="btn danger small" type="button" onClick={() => dropFailed(f)}>
                    {t("Descartar")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Dialog>
  );
}
