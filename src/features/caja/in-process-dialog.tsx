import { Dialog, DialogHead } from "@/ui/dialog";
import { Empty, PendingChip } from "@/ui/parts";
import { useI18n } from "@/i18n";
import { numLabel, timeStr } from "@/features/shared/format";
import type { ConfirmedOrder } from "@/types/order";

/** Lista de pedidos en proceso: «Abrir» los carga en el ticket (modo edición); los pendientes se pueden descartar. */
export function InProcessDialog({
  orders,
  offline,
  onOpen,
  onDiscard,
  onClose,
}: {
  orders: ConfirmedOrder[];
  offline: boolean;
  onOpen: (o: ConfirmedOrder) => void;
  onDiscard: (o: ConfirmedOrder) => void;
  onClose: () => void;
}) {
  const { t, num, money, plural } = useI18n();
  return (
    <Dialog onClose={onClose}>
      <DialogHead title={t("Pedidos en proceso")}>
        <button className="btn plain small" type="button" onClick={onClose}>
          {t("Cerrar")}
        </button>
      </DialogHead>
      {offline && (
        <p className="notice warn">
          <span>{t("Sin conexión: solo se ven los pedidos sin enviar.")}</span>
        </p>
      )}
      {orders.length ? (
        <ul className="sales">
          {orders.map((o) => (
            <li key={o.id} className="srow" data-order={o.id}>
              <div className="s-num">{o.pending ? numLabel(o) : t("nº {n}", { n: num(o.orderNumber) })}</div>
              <div className="s-mid">
                <b>{timeStr(o.date)}</b>
                <span className="soft"> · {plural(o.items.reduce((x, i) => x + i.quantity, 0), "producto")}</span>
              </div>
              <span className="chips">{o.pending && <PendingChip />}</span>
              <b className="s-tot nowrap">{money(o.total)}</b>
              <span className="chips">
                <button className="btn primary small" type="button" onClick={() => onOpen(o)}>
                  {t("Abrir")}
                </button>
                {o.pending && (
                  <button className="btn danger small" type="button" onClick={() => onDiscard(o)}>
                    {t("Descartar")}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty title={t("No hay pedidos en proceso")}>{t("Los verás aquí cuando dejes uno en proceso al cobrar.")}</Empty>
      )}
    </Dialog>
  );
}
