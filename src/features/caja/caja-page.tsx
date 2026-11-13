import { useEffect, useState } from "react";
import { useI18n } from "@/i18n";
import { useCatalog } from "@/state/catalog";
import { useTicket } from "@/state/ticket";
import { useConfirm } from "@/ui/confirm";
import { useToast } from "@/ui/toast";
import { Empty, Skeletons, useLabels } from "@/ui/parts";
import { lineKey, sameLine } from "@/lib/mapping";
import { discardPendingOrder, updateOrder } from "@/lib/order-storage";
import { subscribe } from "@/lib/sync/outbox";
import { errorMessage } from "@/lib/errors";
import { numLabel } from "@/features/shared/format";
import { ProductPicker } from "@/features/shared/product-picker";
import type { ConfirmedOrder } from "@/types/order";
import { Tile } from "./tile";
import { TicketPanel } from "./ticket-panel";
import { PayDialog } from "./pay-dialog";
import { PriceDialog } from "./price-dialog";
import { InProcessDialog } from "./in-process-dialog";
import { useInProcess } from "./use-in-process";

type Dlg = null | "pay" | "inproc" | "picker" | { price: string };

export default function CajaPage() {
  const { t, num, money, plural, dn } = useI18n();
  const { pay } = useLabels();
  const catalog = useCatalog();
  const tk = useTicket();
  const confirm = useConfirm();
  const { toast } = useToast();
  const inproc = useInProcess();
  const [dlg, setDlg] = useState<Dlg>(null);
  const [busy, setBusy] = useState(false);

  // El cobro pendiente recibe su número definitivo cuando el servidor lo confirma
  const saleId = tk.lastSale?.orderId;
  const { patchSale } = tk;
  useEffect(() => {
    if (!saleId) return;
    return subscribe((e) => {
      if (e.type === "confirmed" && e.entry.orderId === saleId && e.entry.kind !== "delete")
        patchSale(saleId, { pending: false, ...(e.order ? { label: num(e.order.number), numberValue: e.order.number } : {}) });
    });
  }, [saleId, patchSale, num]);

  const visible = catalog.products.filter((p) => tk.cat === "all" || p.category === tk.cat);
  const qtyOf = (id: string, half: boolean) =>
    tk.lines.find((l) => l.id === id && !!l.isHalfPortion === half)?.quantity ?? 0;

  const startEdit = async (o: ConfirmedOrder) => {
    if (tk.lines.length && !tk.edit) {
      const ok = await confirm({
        title: t("¿Dejar el ticket actual?"),
        text: t("Se vaciará para abrir el pedido en proceso."),
        ok: t("Sí, abrir el pedido"),
      });
      if (!ok) return;
    }
    setDlg(null);
    tk.openEdit(o);
    window.scrollTo?.(0, 0);
  };

  const exitEdit = async () => {
    if (tk.dirty) {
      const ok = await confirm({
        title: t("¿Salir sin guardar?"),
        text: t("Se perderán los cambios de este pedido."),
        ok: t("Sí, salir"),
        danger: true,
      });
      if (!ok) return;
    }
    tk.exitEdit();
  };

  const saveEdit = async () => {
    if (!tk.edit || !tk.lines.length || busy) return;
    setBusy(true);
    try {
      const res = await updateOrder(tk.edit.order, { items: tk.lines, paymentMethod: tk.edit.method });
      tk.exitEdit();
      toast(t("Cambios guardados."), "ok");
      void res.settled.then((r) => {
        if (!r.synced) toast(t("Guardado sin conexión: se enviará solo."), "ok");
      });
      void inproc.reload();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const cancelOrder = async () => {
    if (!tk.edit || busy) return;
    const order = tk.edit.order;
    const ok = await confirm({
      title: t("¿Anular el pedido nº {n}?", { n: numLabel(order) }),
      text: t("No se sumará al total del día. No se puede deshacer desde la Caja."),
      ok: t("Sí, anular"),
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await updateOrder(order, { status: "cancelado" });
      tk.exitEdit();
      toast(t("Pedido anulado."), "ok");
      void inproc.reload();
    } catch (e) {
      toast(errorMessage(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const discard = async (o: ConfirmedOrder) => {
    const ok = await confirm({
      title: t("¿Descartar el pedido {n}?", { n: numLabel(o) }),
      text: t("Aún no ha llegado al servidor. Se borra de este equipo y no queda rastro. No se puede deshacer."),
      ok: t("Sí, descartar"),
      danger: true,
    });
    if (!ok) return;
    const r = await discardPendingOrder(o);
    if (r.discarded) {
      if (tk.edit?.order.id === o.id) tk.exitEdit();
      toast(t("Pedido descartado."), "ok");
    } else toast(r.reason === "sending" ? t("Se está enviando ahora. Espera un momento.") : t("Ya se envió: no se puede descartar."), "error");
    void inproc.reload();
  };

  const clear = async () => {
    if (await confirm({ title: t("¿Vaciar el ticket?"), text: t("Se quitará todo."), ok: t("Sí, vaciar"), danger: true })) tk.clear();
  };

  const priceLine = typeof dlg === "object" && dlg ? tk.lines.find((l) => lineKey(l) === dlg.price) : undefined;
  const sl = tk.lastSale;

  const banner = sl && (
    <div className="banner" role="status">
      <div>
        <b>{sl.status === "en_proceso" ? t("Pedido {n} en proceso", { n: sl.label }) : t("Venta {n} guardada", { n: sl.label })}</b>
        {" · "}
        {money(sl.total)} · {pay(sl.paymentMethod)}
        {sl.change > 0 && <div className="change">{t("Devolver {m}", { m: money(sl.change) })}</div>}
        {sl.pending && <div className="soft">{t("Pendiente de enviar: se enviará solo cuando haya conexión.")}</div>}
      </div>
      <button className="btn plain small" type="button" onClick={tk.dismissSale}>
        {t("Vale")}
      </button>
    </div>
  );

  let body;
  if (catalog.status === "loading") body = <Skeletons n={8} label={t("Cargando")} />;
  else if (catalog.status === "error")
    body = (
      <div className="state">
        <h2>{t("No se pudo cargar el menú")}</h2>
        <p className="soft">{catalog.error}</p>
        <button className="btn primary big" type="button" onClick={catalog.reload}>
          {t("Reintentar")}
        </button>
      </div>
    );
  else
    body = (
      <>
        <div className="register">
          <div>
            <div className="caja-top">
              <div className="cats" role="group" aria-label={t("Sección del menú")}>
                <button className="cat" type="button" aria-pressed={tk.cat === "all"} onClick={() => tk.setCat("all")}>
                  {t("Todo")}
                </button>
                {catalog.categories.map((c) => (
                  <button key={c.id} className="cat" type="button" aria-pressed={tk.cat === c.id} onClick={() => tk.setCat(c.id)}>
                    {dn(c)}
                  </button>
                ))}
              </div>
              <button className="btn plain inproc-btn" type="button" onClick={() => {
                  void inproc.reload();
                  setDlg("inproc");
                }}>
                {t("En proceso")} ({num(inproc.orders.length)})
              </button>
            </div>
            {visible.length ? (
              <ul className="tiles">
                {visible.map((p) => (
                  <Tile key={p.id} product={p} full={qtyOf(p.id, false)} half={qtyOf(p.id, true)} onAdd={tk.add} />
                ))}
              </ul>
            ) : (
              <Empty title={t("Sin platos aquí")}>{t("Prueba otra sección.")}</Empty>
            )}
          </div>
          <aside className="sticky">
            <TicketPanel
              busy={busy}
              onPay={() => setDlg("pay")}
              onPrice={(key) => setDlg({ price: key })}
              onClear={clear}
              onSaveEdit={saveEdit}
              onExitEdit={exitEdit}
              onCancelOrder={cancelOrder}
              onAddDish={() => setDlg("picker")}
              onDiscard={() => tk.edit && discard(tk.edit.order)}
            />
          </aside>
        </div>
        <div className="mobile-bar">
          <div className="info">
            <span className="soft">{plural(tk.count, "producto")}</span>
            <b>{money(tk.total)}</b>
          </div>
          <button className="btn plain" type="button" onClick={() => document.getElementById("ticket")?.scrollIntoView({ behavior: "smooth" })}>
            {t("Ver ticket")}
          </button>
          <button className="btn primary" type="button" onClick={() => setDlg("pay")} disabled={!tk.lines.length}>
            {t("Cobrar")}
          </button>
        </div>
      </>
    );

  return (
    <>
      <h1 className="sr-only">{t("Caja")}</h1>
      {banner}
      {body}
      {dlg === "pay" && <PayDialog onClose={() => setDlg(null)} />}
      {dlg === "inproc" && (
        <InProcessDialog orders={inproc.orders} offline={inproc.offline} onOpen={startEdit} onDiscard={discard} onClose={() => setDlg(null)} />
      )}
      {dlg === "picker" && (
        <ProductPicker
          onPick={tk.add}
          onClose={() => setDlg(null)}
          countOf={(p, half) => tk.lines.find((l) => sameLine(l, { id: p.id, isHalfPortion: half }))?.quantity ?? 0}
        />
      )}
      {priceLine && (
        <PriceDialog
          line={priceLine}
          onClose={() => setDlg(null)}
          onSave={(price) => {
            tk.setPrice(lineKey(priceLine), price);
            setDlg(null);
          }}
        />
      )}
    </>
  );
}
