import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { ConfirmedOrder, MenuItem, OrderItem, PaymentMethod } from "@/types/order";
import { itemsTotal, lineKey, roundMoney, sameLine, toCents } from "@/lib/mapping";

/** Pedido en proceso abierto en la Caja para editarlo (modo edición del ticket). */
export interface EditInfo {
  order: ConfirmedOrder;
  method: PaymentMethod;
  /** Foto del ticket al abrirlo (para saber si hay cambios sin guardar). */
  snap: string;
}

export interface LastSale {
  orderId: string;
  /** Número definitivo si el servidor ya lo asignó. */
  numberValue?: number;
  label: string;
  total: number;
  paymentMethod: PaymentMethod;
  change: number;
  status: "en_proceso" | "completado";
  pending: boolean;
}

const MAX_QTY = 99;

/** ¿Se puede vender media ración de este plato? (solo raciones con precio de media) */
export const hasHalf = (p: Pick<MenuItem, "portionType" | "halfPortionPrice">) =>
  p.portionType === "racion" && p.halfPortionPrice != null;

/** Línea nueva de un plato del catálogo (precio de carta = precio cobrado). */
export function lineFromProduct(p: MenuItem, half: boolean): OrderItem {
  const price = half && hasHalf(p) ? (p.halfPortionPrice as number) : p.price;
  return {
    id: p.id,
    name: p.name,
    ...(p.names?.ar ? { names: p.names } : {}),
    price,
    listPrice: price,
    image: p.image,
    quantity: 1,
    category: p.category,
    portionType: p.portionType,
    halfPortionPrice: p.halfPortionPrice,
    isHalfPortion: half && hasHalf(p),
  };
}

/** Añade un plato a una lista de líneas: las líneas se identifican por (id, media). */
export function addToLines(lines: OrderItem[], p: MenuItem, half: boolean): OrderItem[] {
  if (!p.available) return lines;
  const next = lineFromProduct(p, half);
  const ex = lines.find((l) => sameLine(l, next));
  if (!ex) return [...lines, next];
  return lines.map((l) => (l === ex ? { ...l, quantity: Math.min(l.quantity + 1, MAX_QTY) } : l));
}

export const snapOf = (lines: OrderItem[], method?: PaymentMethod) =>
  JSON.stringify([lines.map((i) => [i.id, i.name, !!i.isHalfPortion, i.quantity, i.price]), method ?? null]);

interface TicketValue {
  lines: OrderItem[];
  total: number;
  count: number;
  canUndo: boolean;
  edit: EditInfo | null;
  dirty: boolean;
  lastSale: LastSale | null;
  lastMethod: PaymentMethod;
  cat: string;
  setCat: (c: string) => void;
  add: (p: MenuItem, half: boolean) => void;
  inc: (key: string) => void;
  dec: (key: string) => void;
  setPrice: (key: string, price: number) => void;
  undo: () => void;
  clear: () => void;
  removeProduct: (productId: string) => void;
  openEdit: (order: ConfirmedOrder) => void;
  exitEdit: () => void;
  setEditMethod: (m: PaymentMethod) => void;
  finishSale: (sale: LastSale | null, method: PaymentMethod) => void;
  dismissSale: () => void;
  patchSale: (orderId: string, patch: Partial<LastSale>) => void;
}

const Ctx = createContext<TicketValue | null>(null);

/**
 * Estado de la Caja (ticket, modo edición, último cobro, filtro). Vive por encima de las rutas:
 * cambiar de pestaña no pierde el ticket a medias. No se persiste (SPEC: el ticket es local).
 */
export function TicketProvider({ children }: { children: ReactNode }) {
  // líneas e historial de «Deshacer» van juntos para que cada operación sea una función pura
  const [tk, setTk] = useState<{ lines: OrderItem[]; hist: { id: string; half: boolean }[] }>({ lines: [], hist: [] });
  const { lines, hist } = tk;
  const [edit, setEdit] = useState<EditInfo | null>(null);
  const [lastSale, setLastSale] = useState<LastSale | null>(null);
  const [lastMethod, setLastMethod] = useState<PaymentMethod>("efectivo");
  const [cat, setCat] = useState("all");

  const decLine = (l: OrderItem[], pred: (x: OrderItem) => boolean) =>
    l.flatMap((x) => (!pred(x) ? [x] : x.quantity <= 1 ? [] : [{ ...x, quantity: x.quantity - 1 }]));

  const add = useCallback((p: MenuItem, half: boolean) => {
    if (!p.available) return;
    setLastSale(null);
    setTk((t) => ({ lines: addToLines(t.lines, p, half), hist: [...t.hist, { id: p.id, half: half && hasHalf(p) }] }));
  }, []);
  const inc = useCallback((key: string) => {
    setTk((t) => {
      const line = t.lines.find((x) => lineKey(x) === key);
      if (!line) return t;
      return {
        lines: t.lines.map((x) => (x === line ? { ...x, quantity: Math.min(x.quantity + 1, MAX_QTY) } : x)),
        hist: [...t.hist, { id: line.id, half: !!line.isHalfPortion }],
      };
    });
  }, []);
  const dec = useCallback((key: string) => setTk((t) => ({ ...t, lines: decLine(t.lines, (x) => lineKey(x) === key) })), []);
  const setPrice = useCallback(
    (key: string, price: number) =>
      setTk((t) => ({ ...t, lines: t.lines.map((x) => (lineKey(x) === key ? { ...x, price: roundMoney(price) } : x)) })),
    [],
  );
  const undo = useCallback(() => {
    setTk((t) => {
      const hist = [...t.hist];
      while (hist.length) {
        const last = hist.pop()!;
        if (t.lines.some((x) => x.id === last.id && !!x.isHalfPortion === last.half))
          return { lines: decLine(t.lines, (x) => x.id === last.id && !!x.isHalfPortion === last.half), hist };
      }
      return { ...t, hist };
    });
  }, []);
  const clear = useCallback(() => setTk({ lines: [], hist: [] }), []);
  const removeProduct = useCallback(
    (productId: string) => setTk((t) => ({ ...t, lines: t.lines.filter((x) => x.id !== productId) })),
    [],
  );
  const openEdit = useCallback((order: ConfirmedOrder) => {
    const method = order.paymentMethod ?? "efectivo";
    setTk({ lines: order.items.map((i) => ({ ...i })), hist: [] });
    setLastSale(null);
    setEdit({ order, method, snap: snapOf(order.items, method) });
  }, []);
  const exitEdit = useCallback(() => {
    setEdit(null);
    setTk({ lines: [], hist: [] });
  }, []);
  const setEditMethod = useCallback((m: PaymentMethod) => setEdit((e) => (e ? { ...e, method: m } : e)), []);
  const finishSale = useCallback((sale: LastSale | null, method: PaymentMethod) => {
    setLastSale(sale);
    setLastMethod(method);
    setTk({ lines: [], hist: [] });
    setEdit(null);
  }, []);
  const dismissSale = useCallback(() => setLastSale(null), []);
  const patchSale = useCallback(
    (orderId: string, patch: Partial<LastSale>) => setLastSale((s) => (s && s.orderId === orderId ? { ...s, ...patch } : s)),
    [],
  );

  const value = useMemo<TicketValue>(
    () => ({
      lines,
      total: itemsTotal(lines),
      count: lines.reduce((s, i) => s + i.quantity, 0),
      canUndo: hist.length > 0,
      edit,
      dirty: !!edit && edit.snap !== snapOf(lines, edit.method),
      lastSale,
      lastMethod,
      cat,
      setCat,
      add,
      inc,
      dec,
      setPrice,
      undo,
      clear,
      removeProduct,
      openEdit,
      exitEdit,
      setEditMethod,
      finishSale,
      dismissSale,
      patchSale,
    }),
    [lines, hist, edit, lastSale, lastMethod, cat, add, inc, dec, setPrice, undo, clear, removeProduct, openEdit, exitEdit, setEditMethod, finishSale, dismissSale, patchSale],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTicket(): TicketValue {
  const c = useContext(Ctx);
  if (!c) throw new Error("useTicket debe usarse dentro de <TicketProvider>");
  return c;
}

export { toCents };
