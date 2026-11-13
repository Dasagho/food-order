import { useState } from "react";
import { Dialog, DialogHead } from "@/ui/dialog";
import { PendingChip, StatusChip, useLabels } from "@/ui/parts";
import { useConfirm } from "@/ui/confirm";
import { useToast } from "@/ui/toast";
import { useI18n } from "@/i18n";
import { deleteAnyOrder, discardPendingOrder } from "@/lib/order-storage";
import { toCents } from "@/lib/mapping";
import { errorMessage } from "@/lib/errors";
import { numLabel, timeStr } from "@/features/shared/format";
import type { ConfirmedOrder } from "@/types/order";
import { OrderEditor } from "./order-editor";

/** Detalle de una venta (nombres del snapshot) con «Corregir» y «Borrar» (o «Descartar» si está pendiente). */
export function SaleDialog({ order: s, onClose, onChanged }: { order: ConfirmedOrder; onClose: () => void; onChanged: () => void }) {
  const { t, num, money, dn } = useI18n();
  const { pay } = useLabels();
  const confirm = useConfirm();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState("");

  const remove = async () => {
    const ok = await confirm({
      title: t("¿Borrar la venta nº {n}?", { n: numLabel(s) }),
      text: t("Desaparece de Ventas y no suma en el total. Queda guardada como borrada."),
      ok: t("Sí, borrar"),
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteAnyOrder(s);
      toast(t("Venta borrada."), "ok");
      onClose();
      onChanged();
    } catch (e) {
      setErr(errorMessage(e));
    }
  };

  const discard = async () => {
    const ok = await confirm({
      title: t("¿Descartar el pedido {n}?", { n: numLabel(s) }),
      text: t("Aún no ha llegado al servidor. Se borra de este equipo y no queda rastro. No se puede deshacer."),
      ok: t("Sí, descartar"),
      danger: true,
    });
    if (!ok) return;
    const r = await discardPendingOrder(s);
    if (r.discarded) {
      toast(t("Pedido descartado."), "ok");
      onClose();
      onChanged();
    } else setErr(r.reason === "sending" ? t("Se está enviando ahora. Espera un momento.") : t("Ya se envió: no se puede descartar."));
  };

  return (
    <>
      <Dialog onClose={onClose}>
        <div className="dlg-head">
          <div>
            <h2 id="dlg-title">{t("Venta nº {n}", { n: numLabel(s) })}</h2>
            <span className="soft">
              {timeStr(s.date)} · {pay(s.paymentMethod ?? "efectivo")}
            </span>
          </div>
          <span className="chips">
            {(s.pending || s.hasPendingChanges) && <PendingChip />}
            <StatusChip status={s.status} />
          </span>
        </div>
        <ul className="sum-list">
          {s.items.map((i, k) => (
            <li key={k}>
              <span>
                <span className="q">{num(i.quantity)}×</span> {dn(i)}
                {i.isHalfPortion ? " " + t("(media)") : ""}
                {i.listPrice != null && toCents(i.listPrice) !== toCents(i.price) && (
                  <>
                    {" "}
                    <small className="soft">{t("Carta: {m}", { m: money(i.listPrice) })}</small>
                  </>
                )}
              </span>
              <span className="nowrap">{money(i.price * i.quantity)}</span>
            </li>
          ))}
        </ul>
        <div className="total-row" style={{ margin: 0 }}>
          <span>{t("Total")}</span>
          <span className="big">{money(s.total)}</span>
        </div>
        {s.amountReceived != null && (
          <p className="soft">
            {s.change != null
              ? t("Entrega {a} · Devolver {c}", { a: money(s.amountReceived), c: money(s.change) })
              : t("Entrega {a}", { a: money(s.amountReceived) })}
          </p>
        )}
        <p className="error" role="alert">
          {err}
        </p>
        <div className="dlg-foot">
          {s.pending ? (
            <button className="btn danger" type="button" onClick={discard}>
              {t("Descartar")}
            </button>
          ) : (
            <button className="btn danger" type="button" onClick={remove}>
              {t("Borrar")}
            </button>
          )}
          <button className="btn plain" type="button" onClick={() => setEditing(true)}>
            {t("Corregir")}
          </button>
          <button className="btn primary" type="button" data-autofocus onClick={onClose}>
            {t("Cerrar")}
          </button>
        </div>
      </Dialog>
      {editing && (
        <OrderEditor
          order={s}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onClose();
            onChanged();
          }}
          onChanged={onChanged}
        />
      )}
    </>
  );
}
