import { useRef, useState } from "react";
import { Dialog, DialogHead } from "@/ui/dialog";
import { PAYMENT_METHODS, Switch, useLabels } from "@/ui/parts";
import { useI18n } from "@/i18n";
import { saveOrder, updateOrder } from "@/lib/order-storage";
import { errorMessage } from "@/lib/errors";
import { amountOk, parseAmount, r2, numLabel } from "@/features/shared/format";
import { useTicket, type LastSale } from "@/state/ticket";
import type { PaymentMethod } from "@/types/order";

const QUICK = [5, 10, 20, 50];
const wait = (ms: number) => new Promise<"timeout">((r) => setTimeout(() => r("timeout"), ms));

/**
 * Cobro: forma de pago, calculadora de efectivo (ayuda del operario: la app NO cobra) y «Dejar en proceso»
 * (desactivado por defecto). Anti doble toque: `saving` se activa de forma síncrona (ref) antes de cualquier
 * await y el UUID y `createdAt` se crean UNA vez por cobro, así un reintento nunca duplica el pedido.
 */
export function PayDialog({ onClose }: { onClose: () => void }) {
  const { t, money } = useI18n();
  const { pay } = useLabels();
  const tk = useTicket();
  const complete = !!tk.edit; // cobrar un pedido en proceso → completado
  const total = tk.total;

  const [method, setMethod] = useState<PaymentMethod>(tk.edit ? tk.edit.method : tk.lastMethod);
  const [received, setReceived] = useState<number | null>(null);
  const [other, setOther] = useState("");
  const [inproc, setInproc] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const busy = useRef(false);
  const attempt = useRef<{ id: string; createdAt: Date } | null>(null);

  const cash = method === "efectivo" && !inproc;
  const diff = received != null ? r2(received - total) : null;
  const canConfirm = !saving && !(cash && received != null && received < total);

  const chooseMethod = (m: PaymentMethod) => {
    setMethod(m);
    if (m !== "efectivo") {
      setReceived(null);
      setOther("");
    }
  };
  const setOtherAmount = (raw: string) => {
    setOther(raw);
    const v = parseAmount(raw);
    setReceived(amountOk(v) ? r2(v) : null);
  };

  const confirm = async () => {
    if (busy.current) return; // anti doble toque (síncrono, antes del primer await)
    busy.current = true;
    setSaving(true);
    setErr("");
    const amount = cash && received != null ? received : undefined;
    try {
      let label: string;
      let pending: boolean;
      let status: LastSale["status"];
      if (!complete) {
        attempt.current ??= { id: crypto.randomUUID(), createdAt: new Date() };
        status = inproc ? "en_proceso" : "completado";
        const saved = await saveOrder({
          id: attempt.current.id,
          date: attempt.current.createdAt,
          items: tk.lines,
          paymentMethod: method,
          status,
          amountReceived: amount,
        });
        // Número definitivo si el servidor contesta enseguida; si no, queda «P-n» y se actualiza al confirmarse
        const r = await Promise.race([saved.settled, wait(1500)]);
        pending = r === "timeout" || !r.synced;
        label = r !== "timeout" && r.synced && r.number != null ? String(r.number) : `P-${saved.provisionalNumber ?? "?"}`;
        tk.finishSale(
          { orderId: saved.id, label, total, paymentMethod: method, change: amount != null ? Math.max(0, r2(amount - total)) : 0, status, pending, numberValue: r !== "timeout" && r.synced ? r.number : undefined },
          method,
        );
      } else {
        const order = tk.edit!.order;
        status = "completado";
        const res = await updateOrder(order, {
          items: tk.lines,
          paymentMethod: method,
          status: "completado",
          ...(amount !== undefined ? { amountReceived: amount } : {}),
        });
        const r = await Promise.race([res.settled, wait(1500)]);
        pending = r === "timeout" || !r.synced;
        tk.finishSale(
          { orderId: order.id, label: numLabel(order), total, paymentMethod: method, change: amount != null ? Math.max(0, r2(amount - total)) : 0, status, pending, numberValue: order.pending ? undefined : order.orderNumber },
          method,
        );
      }
      onClose();
      window.scrollTo(0, 0);
    } catch (e) {
      busy.current = false;
      setSaving(false);
      setErr(errorMessage(e));
    }
  };

  const title = complete ? t("Cobrar pedido nº {n}", { n: numLabel(tk.edit!.order) }) : t("Cobrar");

  return (
    <Dialog onClose={() => !saving && onClose()}>
      <DialogHead title={title}>
        <button className="btn plain small" type="button" onClick={onClose} disabled={saving}>
          {t("Volver")}
        </button>
      </DialogHead>
      <div className="pay-total">
        <span>{t("Total")}</span>
        <b>{money(total)}</b>
      </div>
      <div className="pay-options" role="group" aria-label={t("Forma de pago")}>
        {PAYMENT_METHODS.map((k) => (
          <button key={k} className="pay" type="button" aria-pressed={method === k} onClick={() => chooseMethod(k)}>
            {pay(k)}
          </button>
        ))}
      </div>
      {cash && (
        <div className="cashbox">
          <span className="label">
            <b>{t("¿Con cuánto paga?")}</b> <span className="soft">{t("(opcional)")}</span>
          </span>
          <div className="quick">
            <button
              className="btn plain"
              type="button"
              aria-pressed={received === total}
              onClick={() => {
                setReceived(total);
                setOther("");
              }}
            >
              {t("Justo")}
            </button>
            {QUICK.map((v) => (
              <button
                key={v}
                className="btn plain"
                type="button"
                aria-pressed={received === v}
                disabled={v < total}
                onClick={() => {
                  setReceived(v);
                  setOther("");
                }}
              >
                {v} €
              </button>
            ))}
          </div>
          <div className="field">
            <label htmlFor="p-other">{t("Otra cantidad (€)")}</label>
            <input
              className="input"
              id="p-other"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              dir="ltr"
              value={other}
              onChange={(e) => setOtherAmount(e.target.value)}
            />
          </div>
          {diff != null &&
            (diff >= 0 ? (
              <p className="change-big" role="status">
                {t("Devolver")} <b>{money(diff)}</b>
              </p>
            ) : (
              <p className="error" role="alert">
                {t("Faltan {m}", { m: money(-diff) })}
              </p>
            ))}
        </div>
      )}
      {!complete && (
        <div className="inproc-opt">
          <Switch
            checked={inproc}
            onChange={() => {
              setInproc(!inproc);
              if (!inproc) setReceived(null);
            }}
          >
            {t("Dejar en proceso")}
          </Switch>
          <p className="soft">
            {inproc
              ? t("No se marca como cobrado. Lo terminas desde «En proceso».")
              : t("Actívalo si el pedido aún no está listo o no se ha cobrado.")}
          </p>
        </div>
      )}
      {err && (
        <p className="error" role="alert">
          {err} {t("No se guardó.")}
        </p>
      )}
      <div className="dlg-foot">
        <button className="btn primary big" type="button" data-pd="confirm" onClick={confirm} disabled={!canConfirm}>
          {saving ? t("Guardando…") : inproc ? t("Guardar en proceso") : t("Confirmar")}
        </button>
      </div>
    </Dialog>
  );
}
