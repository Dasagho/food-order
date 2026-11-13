import { useState } from "react";
import { Dialog, DialogHead } from "@/ui/dialog";
import { STATUSES, PAYMENT_METHODS, useLabels } from "@/ui/parts";
import { useToast } from "@/ui/toast";
import { useI18n } from "@/i18n";
import { ApiError, type PatchOrderBody } from "@/lib/api";
import { correctOrder } from "@/lib/order-storage";
import { hhmmMadrid, madridToUtc, toMadridDateString } from "@/lib/date-utils";
import { errorMessage } from "@/lib/errors";
import { itemToWire, lineKey, sameLine, toCents } from "@/lib/mapping";
import { amountOk, numLabel, parseAmount } from "@/features/shared/format";
import { ProductPicker } from "@/features/shared/product-picker";
import { lineFromProduct } from "@/state/ticket";
import type { ConfirmedOrder, MenuItem, OrderItem, OrderStatus, PaymentMethod } from "@/types/order";

/** Línea en edición: los campos de texto se guardan tal cual se teclean. */
type EdLine = OrderItem & { qRaw: string; pRaw: string };
const toEd = (i: OrderItem): EdLine => ({ ...i, qRaw: String(i.quantity), pRaw: String(i.price) });

/**
 * Corregir un pedido (cualquier campo de cualquier pedido; solo desde Ventas). Se envía únicamente lo que
 * cambió, con `If-Match: revision`. Un plato nuevo se añade con el selector con búsqueda: las líneas siguen
 * identificadas por (producto, media) y el total lo recalcula el servidor.
 */
export function OrderEditor({
  order,
  onClose,
  onSaved,
  onChanged,
}: {
  order: ConfirmedOrder;
  onClose: () => void;
  onSaved: () => void;
  onChanged: () => void;
}) {
  const { t, money, dn } = useI18n();
  const { pay, status: statusLabel } = useLabels();
  const { toast } = useToast();
  const day0 = toMadridDateString(order.date);
  const time0 = hhmmMadrid(order.date);
  const pendingCreate = !!order.pending;

  const [status, setStatus] = useState<OrderStatus>(order.status);
  const [method, setMethod] = useState<PaymentMethod>(order.paymentMethod ?? "efectivo");
  const [recv, setRecv] = useState(order.amountReceived != null ? String(order.amountReceived) : "");
  const [day, setDay] = useState(day0);
  const [time, setTime] = useState(time0);
  const [num, setNum] = useState(pendingCreate ? "" : String(order.orderNumber));
  const [lines, setLines] = useState<EdLine[]>(() => order.items.map(toEd));
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [formErr, setFormErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState(false);
  const itemsKey = JSON.stringify(order.items.map(itemToWire));

  const total = lines.reduce((s, l) => s + toCents(parseAmount(l.pRaw) || 0) * (parseInt(l.qRaw, 10) || 0), 0) / 100;
  const upd = (key: string, patch: Partial<EdLine>) => setLines((ls) => ls.map((l) => (lineKey(l) === key ? { ...l, ...patch } : l)));

  const addDish = (p: MenuItem, half: boolean) =>
    setLines((ls) => {
      const next = lineFromProduct(p, half);
      const ex = ls.find((l) => sameLine(l, next));
      if (!ex) return [...ls, toEd(next)];
      return ls.map((l) => (l === ex ? { ...l, qRaw: String(Math.min((parseInt(l.qRaw, 10) || 0) + 1, 99)) } : l));
    });

  const save = async () => {
    if (saving) return;
    const e: Record<string, string> = {};
    lines.forEach((l) => {
      const q = Number(l.qRaw);
      if (!l.name.trim()) e[lineKey(l)] = t("Falta el nombre.");
      else if (!Number.isInteger(q) || q < 1 || q > 99) e[lineKey(l)] = t("La cantidad va de 1 a 99.");
      else if (!amountOk(parseAmount(l.pRaw))) e[lineKey(l)] = t("Importe no válido. Usa como máximo 2 decimales.");
    });
    if (!day || !time) e.day = t("Falta la fecha o la hora.");
    const recvN = method === "efectivo" ? parseAmount(recv) : null;
    if (method === "efectivo" && recv.trim() !== "" && !amountOk(recvN)) e.recv = t("Importe no válido. Usa como máximo 2 decimales.");
    if (!pendingCreate && (!Number.isInteger(Number(num)) || Number(num) < 1)) e.num = t("Escribe un número de 1 en adelante.");
    setErrs(e);
    setFormErr("");
    if (Object.keys(e).length) return;

    const patch: PatchOrderBody = {};
    if (status !== order.status) patch.status = status;
    if (method !== (order.paymentMethod ?? "efectivo")) patch.paymentMethod = method;
    if (method === "efectivo") {
      if (recv.trim() !== "" && recvN !== order.amountReceived) patch.amountReceived = recvN as number;
      else if (recv.trim() === "" && order.amountReceived != null) patch.amountReceived = null;
    } else if (order.amountReceived != null) patch.amountReceived = null;
    if (day !== day0 || time !== time0) patch.createdAt = madridToUtc(day, time);
    if (!pendingCreate && Number(num) !== order.orderNumber) patch.number = Number(num);
    const items = lines.map((l) => itemToWire({ ...l, quantity: Number(l.qRaw), price: parseAmount(l.pRaw) as number }));
    if (JSON.stringify(items) !== itemsKey) patch.items = items;
    if (!Object.keys(patch).length) return onClose();

    setSaving(true);
    try {
      await correctOrder(order, patch);
      toast(t("Venta corregida."), "ok");
      onSaved();
    } catch (er) {
      setSaving(false);
      if (er instanceof ApiError && er.code === "revision_mismatch") {
        toast(errorMessage(er), "error");
        onClose();
        onChanged();
        return;
      }
      if (er instanceof ApiError && er.code === "number_taken") setErrs({ num: errorMessage(er) });
      else setFormErr(errorMessage(er));
    }
  };

  return (
    <>
      <Dialog onClose={() => !saving && onClose()}>
        <DialogHead title={t("Corregir venta nº {n}", { n: numLabel(order) })}>
          <button className="btn plain small" type="button" onClick={onClose} disabled={saving}>
            {t("Cerrar")}
          </button>
        </DialogHead>
        <div className="two">
          <div className="field">
            <label htmlFor="ed-status">{t("Estado")}</label>
            <select className="input" id="ed-status" value={status} onChange={(e) => setStatus(e.target.value as OrderStatus)}>
              {STATUSES.map((k) => (
                <option key={k} value={k}>
                  {statusLabel(k)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="ed-method">{t("Forma de pago")}</label>
            <select className="input" id="ed-method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {PAYMENT_METHODS.map((k) => (
                <option key={k} value={k}>
                  {pay(k)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {method === "efectivo" && (
          <div className="field">
            <label htmlFor="ed-recv">
              {t("Entrega (€)")} <span className="soft">{t("(opcional)")}</span>
            </label>
            <input
              className="input"
              id="ed-recv"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              dir="ltr"
              value={recv}
              aria-describedby="ed-e-recv"
              aria-invalid={errs.recv ? true : undefined}
              onChange={(e) => setRecv(e.target.value)}
            />
            {errs.recv && (
              <span className="error" id="ed-e-recv" role="alert">
                {errs.recv}
              </span>
            )}
          </div>
        )}
        <div className="two">
          <div className="field">
            <label htmlFor="ed-day">{t("Fecha")}</label>
            <input className="input" id="ed-day" type="date" dir="ltr" value={day} onChange={(e) => setDay(e.target.value)} />
            {errs.day && (
              <span className="error" role="alert">
                {errs.day}
              </span>
            )}
          </div>
          <div className="field">
            <label htmlFor="ed-time">{t("Hora")}</label>
            <input className="input" id="ed-time" type="time" dir="ltr" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="ed-num">{t("Número del pedido")}</label>
          <input
            className="input"
            id="ed-num"
            type="number"
            inputMode="numeric"
            min="1"
            step="1"
            dir="ltr"
            value={num}
            disabled={pendingCreate}
            aria-describedby="ed-h-num"
            onChange={(e) => setNum(e.target.value)}
          />
          <span className="help" id="ed-h-num">
            {pendingCreate ? t("Se asigna al enviarlo.") : t("Cambiarlo no reordena el resto.")}
          </span>
          {errs.num && (
            <span className="error" role="alert">
              {errs.num}
            </span>
          )}
        </div>
        <h3>{t("Líneas")}</h3>
        <ul className="edlines">
          {lines.map((l) => {
            const key = lineKey(l);
            const nm = l.name;
            return (
              <li key={key} className="edl" data-line={key}>
                <div className="field">
                  <label htmlFor={`ed-n-${key}`}>
                    {t("Plato")}
                    {l.isHalfPortion ? " " + t("(media)") : ""}
                  </label>
                  <input className="input" id={`ed-n-${key}`} value={l.name} autoComplete="off" onChange={(e) => upd(key, { name: e.target.value })} />
                </div>
                <div className="two">
                  <div className="field">
                    <label htmlFor={`ed-q-${key}`}>{t("Cantidad")}</label>
                    <input
                      className="input"
                      id={`ed-q-${key}`}
                      type="number"
                      inputMode="numeric"
                      min="1"
                      max="99"
                      step="1"
                      dir="ltr"
                      value={l.qRaw}
                      onChange={(e) => upd(key, { qRaw: e.target.value })}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor={`ed-p-${key}`}>{t("Precio (€)")}</label>
                    <input
                      className="input"
                      id={`ed-p-${key}`}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      dir="ltr"
                      value={l.pRaw}
                      onChange={(e) => upd(key, { pRaw: e.target.value })}
                    />
                    {l.listPrice != null && <span className="help">{t("Carta: {m}", { m: money(l.listPrice) })}</span>}
                  </div>
                </div>
                {errs[key] && (
                  <span className="error" role="alert">
                    {errs[key]}
                  </span>
                )}
                <button
                  className="btn danger small"
                  type="button"
                  disabled={lines.length < 2}
                  aria-label={t("Quitar la línea: {p}", { p: nm })}
                  onClick={() => setLines((ls) => ls.filter((x) => lineKey(x) !== key))}
                >
                  {t("Quitar línea")}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="field addline">
          <button className="btn plain" type="button" onClick={() => setPicker(true)}>
            {t("Añadir un plato")}
          </button>
        </div>
        <div className="total-row" style={{ margin: 0 }}>
          <span>{t("Total")}</span>
          <span className="big" aria-live="polite">
            {money(total)}
          </span>
        </div>
        <p className="error" role="alert">
          {formErr}
        </p>
        <div className="dlg-foot">
          <button className="btn plain" type="button" onClick={onClose} disabled={saving}>
            {t("Cancelar")}
          </button>
          <button className="btn primary" type="button" id="ed-save" onClick={save} disabled={saving}>
            {saving ? t("Guardando…") : t("Guardar")}
          </button>
        </div>
      </Dialog>
      {picker && (
        <ProductPicker
          onPick={addDish}
          onClose={() => setPicker(false)}
          countOf={(p, half) => Number(lines.find((l) => sameLine(l, { id: p.id, isHalfPortion: half }))?.qRaw) || 0}
        />
      )}
    </>
  );
}
