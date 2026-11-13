import { useI18n } from "@/i18n";
import { PAYMENT_METHODS, PendingChip, StatusChip, useLabels } from "@/ui/parts";
import { useTicket } from "@/state/ticket";
import { lineKey, toCents } from "@/lib/mapping";
import { numLabel } from "@/features/shared/format";
import type { OrderItem } from "@/types/order";

interface Props {
  onPay: () => void;
  onPrice: (key: string) => void;
  onClear: () => void;
  onSaveEdit: () => void;
  onExitEdit: () => void;
  onCancelOrder: () => void;
  onAddDish: () => void;
  onDiscard: () => void;
  busy: boolean;
}

function Line({ item: i, onPrice }: { item: OrderItem; onPrice: (key: string) => void }) {
  const { t, num, money, dn } = useI18n();
  const tk = useTicket();
  const key = lineKey(i);
  const nm = dn(i);
  const adj = i.listPrice != null && toCents(i.listPrice) !== toCents(i.price);
  return (
    <li className="tl" data-line={key}>
      <div className="tl-name">
        <b>{nm}</b>
        {i.isHalfPortion ? " " + t("(media)") : ""}{" "}
        <button
          className="pricebtn nowrap"
          type="button"
          aria-label={t("Cambiar el precio de {p}. Ahora {m}", { p: nm, m: money(i.price) })}
          onClick={() => onPrice(key)}
        >
          {money(i.price)}
          {adj && (
            <>
              {" "}
              <small>{t("(cambiado)")}</small>
            </>
          )}
        </button>
      </div>
      <div className="tl-ctl">
        <div className="qty sm">
          <button className="btn plain" type="button" aria-label={t("Quitar uno: {p}", { p: nm })} onClick={() => tk.dec(key)}>
            −
          </button>
          <span className="count">{num(i.quantity)}</span>
          <button className="btn primary" type="button" aria-label={t("Añadir uno más: {p}", { p: nm })} onClick={() => tk.inc(key)}>
            +
          </button>
        </div>
        <span className="tl-sub nowrap">{money(i.price * i.quantity)}</span>
      </div>
    </li>
  );
}

/** Ticket: líneas con −/+ y precio por línea, total con aria-live, Cobrar, Deshacer, Vaciar (y modo edición). */
export function TicketPanel({ onPay, onPrice, onClear, onSaveEdit, onExitEdit, onCancelOrder, onAddDish, onDiscard, busy }: Props) {
  const { t, money } = useI18n();
  const { pay } = useLabels();
  const tk = useTicket();
  const ed = tk.edit;
  const empty = tk.lines.length === 0;

  return (
    <section className={`panel ticket ${ed ? "editing" : ""}`} id="ticket" aria-labelledby="tk-t">
      <h2 id="tk-t">
        {ed ? (
          <>
            {t("Pedido nº {n}", { n: numLabel(ed.order) })} <StatusChip status="en_proceso" />
            {ed.order.pending && <PendingChip />}
          </>
        ) : (
          t("Ticket")
        )}
      </h2>
      {ed && (
        <div className="pay-options small" role="group" aria-label={t("Forma de pago")}>
          {PAYMENT_METHODS.map((k) => (
            <button key={k} className="pay" type="button" aria-pressed={ed.method === k} onClick={() => tk.setEditMethod(k)}>
              {pay(k)}
            </button>
          ))}
        </div>
      )}
      {empty ? (
        <div className="empty">
          <strong>{t("Ticket vacío")}</strong>
          {t("Toca un plato.")}
        </div>
      ) : (
        <ul className="ticket-list">
          {tk.lines.map((i) => (
            <Line key={lineKey(i)} item={i} onPrice={onPrice} />
          ))}
        </ul>
      )}
      {ed && (
        <button className="btn plain" type="button" onClick={onAddDish} style={{ marginBottom: "var(--s3)" }}>
          {t("Añadir un plato")}
        </button>
      )}
      <div className="total-row">
        <span>{t("Total")}</span>
        <span className="big" aria-live="polite">
          {money(tk.total)}
        </span>
      </div>
      <button className="btn primary big" type="button" data-act="pay" onClick={onPay} disabled={empty || busy}>
        {t("Cobrar")} {empty ? "" : money(tk.total)}
      </button>
      {ed ? (
        <>
          <div className="tk-sec three">
            <button className="btn plain" type="button" onClick={onSaveEdit} disabled={empty || busy}>
              {t("Guardar cambios")}
            </button>
            <button className="btn plain" type="button" onClick={onExitEdit}>
              {t("Salir sin guardar")}
            </button>
            <button className="btn danger" type="button" onClick={onCancelOrder} disabled={busy}>
              {t("Anular pedido")}
            </button>
          </div>
          {ed.order.pending && (
            <div className="tk-sec">
              <button className="btn danger" type="button" onClick={onDiscard} style={{ gridColumn: "1 / -1" }}>
                {t("Descartar este pedido")}
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="tk-sec">
          <button className="btn plain" type="button" onClick={tk.undo} disabled={!tk.canUndo}>
            {t("Deshacer")}
          </button>
          <button className="btn danger" type="button" onClick={onClear} disabled={empty}>
            {t("Vaciar")}
          </button>
        </div>
      )}
    </section>
  );
}
