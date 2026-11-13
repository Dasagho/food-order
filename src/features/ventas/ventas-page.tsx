import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useI18n } from "@/i18n";
import { useToast } from "@/ui/toast";
import { Empty, PendingChip, Skeletons, StatusChip, useLabels, PAYMENT_METHODS } from "@/ui/parts";
import { getDailySummary, getOrderDays, getOrdersForDay, type DaySummary } from "@/lib/order-storage";
import { subscribe } from "@/lib/sync/outbox";
import { api } from "@/lib/api";
import { shiftDay, todayMadrid } from "@/lib/date-utils";
import { errorMessage, isOfflineError } from "@/lib/errors";
import { numLabel, timeStr } from "@/features/shared/format";
import { useOnline } from "@/state/use-online";
import type { ConfirmedOrder } from "@/types/order";
import { SaleDialog } from "./sale-dialog";

type State = "loading" | "ok" | "error";

export default function VentasPage() {
  const { t, num, money, plural, dn, locale } = useI18n();
  const { pay } = useLabels();
  const { toast } = useToast();
  const online = useOnline();
  const [day, setDay] = useState(todayMadrid);
  const [days, setDays] = useState<Record<string, number>>({});
  const [orders, setOrders] = useState<ConfirmedOrder[]>([]);
  const [summary, setSummary] = useState<DaySummary | null>(null);
  const [reportErr, setReportErr] = useState("");
  const [offline, setOffline] = useState(false);
  const [state, setState] = useState<State>("loading");
  const [err, setErr] = useState("");
  const [detail, setDetail] = useState<string | null>(null);
  const seq = useRef(0);
  const today = todayMadrid();

  // Solo cuenta la última petición; al cambiar de día no se enseña la lista vieja
  const load = useCallback(
    async (opts: { keep?: boolean } = {}) => {
      const mine = ++seq.current;
      if (!opts.keep) setState("loading");
      try {
        const [list, dayList, rep] = await Promise.all([
          getOrdersForDay(day),
          getOrderDays(),
          getDailySummary(day).then(
            (r) => ({ r }),
            (e) => ({ e }),
          ),
        ]);
        if (mine !== seq.current) return;
        setOrders(list.orders);
        setOffline(list.offline);
        setDays(dayList.counts);
        if ("r" in rep) {
          setSummary(rep.r);
          setReportErr("");
        } else {
          setSummary(null);
          setReportErr(isOfflineError(rep.e) ? "" : errorMessage(rep.e));
        }
        setState("ok");
      } catch (e) {
        if (mine !== seq.current) return;
        setErr(errorMessage(e));
        setState("error");
      }
    },
    [day],
  );

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(
    () =>
      subscribe((e) => {
        if (e.type === "confirmed" || e.type === "conflict") void load({ keep: true });
      }),
    [load],
  );

  const longDay = (s: string) =>
    new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${s}T12:00:00Z`));
  const shortDay = (s: string) =>
    new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${s}T12:00:00Z`));

  // El selector solo ofrece los días con pedidos (GET /orders/days) + el día elegido
  const known = new Map(Object.entries(days));
  if (!known.has(day)) known.set(day, 0);
  const options = [...known.keys()].sort().reverse();
  const yesterday = shiftDay(today, -1);

  const downloadCsv = async () => {
    try {
      const csv = await api.reports.csv(day, day);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      a.download = `ventas-${day}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (e) {
      toast(errorMessage(e), "error");
    }
  };

  const head = (
    <div className="page-head">
      <div>
        <h1>{t("Ventas")}</h1>
        <p className="soft day-name">{longDay(day)}</p>
      </div>
      <div className="dayfilter" role="group" aria-label={t("Elegir día")}>
        <button className={`btn ${day === today ? "primary" : "plain"}`} type="button" aria-pressed={day === today} onClick={() => setDay(today)}>
          {t("Hoy")}
        </button>
        <button className={`btn ${day === yesterday ? "primary" : "plain"}`} type="button" aria-pressed={day === yesterday} onClick={() => setDay(yesterday)}>
          {t("Ayer")}
        </button>
        <div className="field inline">
          <label htmlFor="dpick">{t("Otro día:")}</label>
          <select className="input" id="dpick" dir="ltr" value={day} onChange={(e) => e.target.value && setDay(e.target.value)}>
            {options.map((d) => {
              const n = known.get(d);
              return (
                <option key={d} value={d}>
                  {shortDay(d)}
                  {n ? ` (${num(n)})` : ""}
                </option>
              );
            })}
          </select>
        </div>
      </div>
    </div>
  );

  if (state === "loading") return <>{head}<Skeletons n={3} label={t("Cargando")} /></>;
  if (state === "error")
    return (
      <>
        {head}
        <div className="state">
          <h2>{t("No se pudieron cargar las ventas")}</h2>
          <p className="soft">{err}</p>
          <button className="btn primary big" type="button" onClick={() => load()}>
            {t("Reintentar")}
          </button>
        </div>
      </>
    );

  const pendingN = orders.filter((o) => o.pending).length;
  const r = summary?.report;
  const stats =
    r && !offline ? (
      <>
        <section className="stats" aria-label={t("Resumen del día")}>
          <div className="stat main">
            <span>{t("Total del día")}</span>
            <b data-testid="day-total">{money(r.total)}</b>
            <small>{plural(r.orders, "venta")}</small>
          </div>
          {PAYMENT_METHODS.map((m) => (
            <div key={m} className="stat" data-testid={`pay-${m}`}>
              <span>{pay(m)}</span>
              <b>{money(r.byPaymentMethod[m] || 0)}</b>
            </div>
          ))}
        </section>
        {r.cancelled.orders > 0 && (
          <p className="soft cancelled-line">{t("Anuladas: {n} · {m}. No se suman al total.", { n: plural(r.cancelled.orders, "venta"), m: money(r.cancelled.total) })}</p>
        )}
        {pendingN > 0 && <p className="soft">{t("Hay {n} sin enviar que todavía no suman.", { n: plural(pendingN, "pedido") })}</p>}
        {r.byProduct.length > 0 && (
          <details className="byprod">
            <summary>{t("Platos vendidos")}</summary>
            <ul className="sum-list">
              {r.byProduct.map((p) => (
                <li key={`${p.productId ?? p.name}-${p.half}`}>
                  <span>
                    <span className="q">{num(p.quantity)}×</span> {dn(p)}
                    {p.half ? " " + t("(media)") : ""}
                  </span>
                  <span className="nowrap">{money(p.total)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </>
    ) : reportErr && !offline ? (
      <p className="error" role="alert">
        {reportErr}
      </p>
    ) : null;

  const offlineNote = offline && (
    <p className="notice warn" role="status">
      <span>{t("Sin conexión: solo se ven los pedidos sin enviar. El resto está en el servidor.")}</span>
    </p>
  );

  const selected = orders.find((o) => o.id === detail);

  return (
    <>
      {head}
      {offlineNote}
      {stats}
      {orders.length === 0 ? (
        <Empty title={t("Sin ventas este día")}>
          {t("Aquí verás lo que cobres.")}
          <div style={{ marginTop: 16 }}>
            <Link className="btn primary" to="/">
              {t("Ir a la Caja")}
            </Link>
          </div>
        </Empty>
      ) : (
        <>
          <h2 style={{ margin: "24px 0 12px" }}>{t("Ventas del día")}</h2>
          <ul className="sales">
            {orders.map((s) => (
              <li key={s.id} className={`srow ${s.status === "cancelado" ? "void" : ""}`} data-order={s.id}>
                <div className="s-num">{s.pending ? numLabel(s) : t("nº {n}", { n: num(s.orderNumber) })}</div>
                <div className="s-mid">
                  <b>{timeStr(s.date)}</b>
                  <span className="soft">
                    {" "}
                    · {pay(s.paymentMethod ?? "efectivo")} · {plural(s.items.reduce((x, i) => x + i.quantity, 0), "producto")}
                  </span>
                </div>
                <span className="chips">
                  {(s.pending || s.hasPendingChanges) && <PendingChip />}
                  <StatusChip status={s.status} />
                </span>
                <b className="s-tot nowrap">{money(s.total)}</b>
                <button className="btn plain small" type="button" onClick={() => setDetail(s.id)}>
                  {t("Ver")}
                </button>
              </li>
            ))}
          </ul>
          {online && (
            <div style={{ marginTop: 16 }}>
              <button className="btn plain small" type="button" onClick={downloadCsv}>
                {t("Descargar el día (CSV)")}
              </button>
            </div>
          )}
        </>
      )}
      {selected && <SaleDialog order={selected} onClose={() => setDetail(null)} onChanged={() => load({ keep: true })} />}
    </>
  );
}
