/**
 * Capa de pedidos. El servidor es la fuente de verdad:
 *  - las lecturas van a la API y se les superponen los cambios aún pendientes en la cola;
 *  - las escrituras (crear, editar, borrar) entran SIEMPRE por la cola de salida
 *    (durable, idempotente por UUID y con sincronización en segundo plano).
 */
import { ApiError, api } from "@/lib/api";
import type { ApiOrder, CreateOrderBody, DailyReport, PatchOrderBody } from "@/lib/api";
import { getOrderTimestamp, shiftDay, toMadridDateString, todayMadrid } from "@/lib/date-utils";
import { isOfflineError } from "@/lib/errors";
import { itemFromWire, itemToWire, itemsTotal, lineKey, orderFromApi, roundMoney } from "@/lib/mapping";
import { OrderRuleError, allowedTransitions, canEditFromRegister } from "@/lib/order-rules";
import * as outbox from "@/lib/sync/outbox";
import type { OutboxEntry } from "@/lib/sync/outbox";
import type { ConfirmedOrder, OrderItem, OrderStatus, PaymentMethod } from "@/types/order";

// ───────────── vista de pedidos con cambios pendientes ─────────────
type WireItem = CreateOrderBody["items"][number];

function wireItemsToView(items: WireItem[], images: Record<string, string>): OrderItem[] {
  return items.map((w) => {
    const base = itemFromWire({ ...w, listPrice: w.listPrice ?? null });
    return { ...base, image: images[lineKey(base)] ?? "" };
  });
}

export function pendingOrderFromEntry(entry: OutboxEntry, patches: OutboxEntry[] = []): ConfirmedOrder {
  const merged = patches.reduce<CreateOrderBody>(
    (acc, p) => ({ ...acc, ...(p.payload as PatchOrderBody) }) as CreateOrderBody,
    entry.payload as CreateOrderBody,
  );
  const items = wireItemsToView(merged.items, entry.images ?? {});
  return {
    id: merged.id,
    orderNumber: 0,
    items,
    total: itemsTotal(items),
    date: new Date(merged.createdAt),
    status: merged.status ?? "completado",
    paymentMethod: merged.paymentMethod,
    amountReceived: merged.amountReceived ?? null,
    pending: true,
    provisionalNumber: entry.provisional,
  };
}

function applyPatch(order: ConfirmedOrder, patch: PatchOrderBody): ConfirmedOrder {
  const images: Record<string, string> = {};
  order.items.forEach((i) => (images[lineKey(i)] = i.image));
  const items = patch.items ? wireItemsToView(patch.items, images) : order.items;
  return {
    ...order,
    items,
    total: itemsTotal(items),
    date: patch.createdAt ? new Date(patch.createdAt) : order.date,
    status: patch.status ?? order.status,
    paymentMethod: patch.paymentMethod ?? order.paymentMethod,
    amountReceived: patch.amountReceived === undefined ? order.amountReceived : patch.amountReceived,
    hasPendingChanges: true,
  };
}

/** Superpone la cola de salida a los pedidos que devolvió el servidor para un día. */
export function overlayOutbox(server: ConfirmedOrder[], entries: OutboxEntry[], day?: string): ConfirmedOrder[] {
  const deleted = new Set(entries.filter((e) => e.kind === "delete").map((e) => e.orderId));
  const patchesBy = new Map<string, OutboxEntry[]>();
  entries
    .filter((e) => e.kind === "patch")
    .forEach((e) => patchesBy.set(e.orderId, [...(patchesBy.get(e.orderId) ?? []), e]));

  const out: ConfirmedOrder[] = [];
  const seen = new Set<string>();
  for (const o of server) {
    seen.add(o.id);
    if (deleted.has(o.id)) continue;
    out.push(
      (patchesBy.get(o.id) ?? []).reduce((acc, p) => applyPatch(acc, p.payload as PatchOrderBody), o),
    );
  }
  for (const e of entries) {
    if (e.kind !== "create" || seen.has(e.orderId) || deleted.has(e.orderId)) continue;
    const view = pendingOrderFromEntry(e, patchesBy.get(e.orderId));
    if (day && toMadridDateString(view.date) !== day) continue;
    out.push(view);
  }
  return out.sort(
    (a, b) => b.date.getTime() - a.date.getTime() || b.orderNumber - a.orderNumber,
  );
}

// ───────────── lecturas ─────────────
export interface DayOrders {
  orders: ConfirmedOrder[];
  /** No se pudo consultar al servidor: solo se muestran los pendientes locales. */
  offline: boolean;
}

const isUnreachable = (e: unknown) =>
  isOfflineError(e) || (e instanceof ApiError && (e.status === 429 || e.status === 401));

export async function getOrdersForDay(day: string): Promise<DayOrders> {
  const entries = await outbox.listPending();
  try {
    const server = await api.orders.list({ date: day });
    return { orders: overlayOutbox(server.map(orderFromApi), entries, day), offline: false };
  } catch (e) {
    if (!isUnreachable(e)) throw e;
    // Sin conexión: solo los pendientes locales (de cualquier día)
    return { orders: overlayOutbox([], entries), offline: true };
  }
}

/** Pedidos en proceso (últimos 30 días del servidor + los pendientes locales). */
export async function getInProcessOrders(): Promise<DayOrders> {
  const entries = await outbox.listPending();
  const today = todayMadrid();
  try {
    const server = await api.orders.list({ from: shiftDay(today, -30), to: today, status: "en_proceso" });
    const orders = overlayOutbox(server.map(orderFromApi), entries).filter((o) => o.status === "en_proceso");
    return { orders: orders.sort((a, b) => a.date.getTime() - b.date.getTime()), offline: false };
  } catch (e) {
    if (!isUnreachable(e)) throw e;
    const orders = overlayOutbox([], entries).filter((o) => o.status === "en_proceso");
    return { orders: orders.sort((a, b) => a.date.getTime() - b.date.getTime()), offline: true };
  }
}

/** Pedidos creados en este dispositivo que aún no han llegado al servidor (lo único descartable). */
export async function getPendingOrders(): Promise<ConfirmedOrder[]> {
  const entries = await outbox.listPending();
  return overlayOutbox([], entries).sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Días de negocio con pedidos (selector de fecha), con su número de pedidos. */
export async function getOrderDays(): Promise<{ days: string[]; counts: Record<string, number>; offline: boolean }> {
  const entries = await outbox.listPending();
  const counts: Record<string, number> = {};
  entries
    .filter((e) => e.kind === "create")
    .forEach((e) => {
      const d = toMadridDateString(new Date((e.payload as CreateOrderBody).createdAt));
      counts[d] = (counts[d] ?? 0) + 1;
    });
  const sorted = () => Object.keys(counts).sort((a, b) => b.localeCompare(a));
  try {
    for (const d of await api.orders.days()) counts[d.day] = (counts[d.day] ?? 0) + d.count;
    return { days: sorted(), counts, offline: false };
  } catch (e) {
    if (!isUnreachable(e)) throw e;
    return { days: sorted(), counts, offline: true };
  }
}

/** Resumen calculado en local (con lo pendiente cuando no hay servidor). Los cancelados no cuentan. */
export function summarizeOrders(day: string, orders: ConfirmedOrder[]): DailyReport {
  const report: DailyReport = {
    day,
    orders: 0,
    units: 0,
    total: 0,
    byPaymentMethod: { efectivo: 0, tarjeta: 0, bizum: 0 },
    byProduct: [],
    cancelled: { orders: 0, total: 0 },
  };
  const products = new Map<string, DailyReport["byProduct"][number]>();
  let totalCents = 0;
  let cancelledCents = 0;
  const methodCents: Record<PaymentMethod, number> = { efectivo: 0, tarjeta: 0, bizum: 0 };
  for (const o of orders) {
    const cents = Math.round(o.total * 100);
    if (o.status === "cancelado") {
      report.cancelled.orders++;
      cancelledCents += cents;
      continue;
    }
    report.orders++;
    totalCents += cents;
    methodCents[o.paymentMethod ?? "efectivo"] += cents;
    for (const i of o.items) {
      report.units += i.quantity;
      const key = `${i.id}|${i.isHalfPortion ? 1 : 0}`;
      const row = products.get(key) ?? {
        productId: i.id.startsWith("n:") ? null : i.id,
        name: i.name,
        half: !!i.isHalfPortion,
        quantity: 0,
        total: 0,
      };
      row.quantity += i.quantity;
      row.total = (Math.round(row.total * 100) + Math.round(i.price * 100) * i.quantity) / 100;
      products.set(key, row);
    }
  }
  report.total = totalCents / 100;
  report.cancelled.total = cancelledCents / 100;
  (Object.keys(methodCents) as PaymentMethod[]).forEach((m) => (report.byPaymentMethod[m] = methodCents[m] / 100));
  report.byProduct = [...products.values()].sort((a, b) => b.total - a.total);
  return report;
}

export interface DaySummary {
  report: DailyReport;
  offline: boolean;
  /** Pedidos de ese día pendientes de sincronizar que el informe del servidor aún no incluye. */
  pendingCount: number;
}

export async function getDailySummary(day: string): Promise<DaySummary> {
  const entries = await outbox.listPending();
  const pendingToday = overlayOutbox([], entries, day);
  try {
    const rows = await api.reports.daily(day, day);
    const report =
      rows.find((r) => r.day === day) ?? summarizeOrders(day, []);
    return { report, offline: false, pendingCount: pendingToday.length };
  } catch (e) {
    if (!isUnreachable(e)) throw e;
    return { report: summarizeOrders(day, pendingToday), offline: true, pendingCount: pendingToday.length };
  }
}

// ───────────── escrituras (siempre vía cola de salida) ─────────────
export interface NewOrderInput {
  /** UUID del pedido: si se reutiliza en un reintento, nunca se duplica. */
  id?: string;
  items: OrderItem[];
  paymentMethod: PaymentMethod;
  /** "en_proceso" si se deja en proceso; por defecto "completado". */
  status?: Extract<OrderStatus, "en_proceso" | "completado">;
  /** Importe entregado en efectivo (solo ayuda del operario: la app no cobra). */
  amountReceived?: number;
  date?: Date;
}

export interface SavedOrder {
  id: string;
  provisionalNumber?: number;
  /** Se resuelve cuando termina el primer intento de sincronización. */
  settled: Promise<{ synced: boolean; number?: number }>;
}

export async function saveOrder(input: NewOrderInput): Promise<SavedOrder> {
  if (input.items.length === 0) throw new OrderRuleError("El pedido debe tener al menos un artículo");
  const id = input.id ?? crypto.randomUUID();
  const payload: CreateOrderBody = {
    id,
    createdAt: (input.date ?? getOrderTimestamp()).toISOString(),
    status: input.status ?? "completado",
    paymentMethod: input.paymentMethod,
    items: input.items.map(itemToWire),
  };
  if (input.amountReceived !== undefined) payload.amountReceived = roundMoney(input.amountReceived);
  const images: Record<string, string> = {};
  input.items.forEach((i) => (images[lineKey(i)] = i.image));
  const entry = await outbox.enqueueCreate(payload, images);

  let number: number | undefined;
  const off = outbox.subscribe((e) => {
    if (e.type === "confirmed" && e.entry.orderId === id) number = e.order?.number;
  });
  const settled = outbox.flush().then(async () => {
    off();
    const still = (await outbox.listPending()).some((e) => e.orderId === id);
    return { synced: !still, number };
  });
  return { id, provisionalNumber: entry.provisional, settled };
}

function assertEditable(order: ConfirmedOrder) {
  if (!canEditFromRegister(order))
    throw new OrderRuleError("Solo se pueden editar desde la caja los pedidos en proceso");
}

/**
 * Desde la Caja, sobre un pedido en proceso: líneas (cantidad, precio unitario, quitar, añadir),
 * forma de pago y la transición en_proceso → completado | cancelado. Una sola petición en la cola.
 */
export async function updateOrder(
  order: ConfirmedOrder,
  changes: { items?: OrderItem[]; paymentMethod?: PaymentMethod; status?: OrderStatus; amountReceived?: number | null },
): Promise<{ settled: Promise<{ synced: boolean }> }> {
  assertEditable(order);
  const patch: PatchOrderBody = {};
  if (changes.items) {
    if (changes.items.length === 0) throw new OrderRuleError("El pedido debe tener al menos un artículo");
    patch.items = changes.items.map((i) => ({ ...itemToWire(i), unitPrice: roundMoney(i.price) }));
  }
  if (changes.paymentMethod) patch.paymentMethod = changes.paymentMethod;
  if (changes.status) {
    if (!allowedTransitions(order).includes(changes.status))
      throw new OrderRuleError(`Transición no permitida desde la caja: ${order.status} → ${changes.status}`);
    patch.status = changes.status;
  }
  if (changes.amountReceived !== undefined)
    patch.amountReceived = changes.amountReceived === null ? null : roundMoney(changes.amountReceived);
  if (Object.keys(patch).length === 0) return { settled: Promise.resolve({ synced: true }) };
  await outbox.enqueuePatch(order.id, patch, order.revision);
  // Se resuelve al terminar el primer intento de envío: synced=false si el cambio sigue en la cola
  const settled = outbox.flush().then(async () => ({
    synced: !(await outbox.listPending()).some((e) => e.orderId === order.id),
  }));
  return { settled };
}

/** en_proceso → completado | cancelado. */
export async function updateOrderStatus(order: ConfirmedOrder, status: OrderStatus) {
  return updateOrder(order, { status });
}

/**
 * Pantalla Ventas (administración conectada al servidor): corrige CUALQUIER campo de CUALQUIER pedido.
 * Un pedido ya en el servidor se envía directamente (con `If-Match`) para poder mostrar el error junto
 * al campo (number_taken, invalid_amount…); si el pedido aún está pendiente, el cambio se funde con su
 * entrada `create` de la cola (no existe todavía en el servidor).
 * Devuelve el pedido ya corregido del servidor, o `undefined` si el cambio quedó en la cola.
 */
export async function correctOrder(order: ConfirmedOrder, patch: PatchOrderBody): Promise<ApiOrder | undefined> {
  if (Object.keys(patch).length === 0) return undefined;
  if (order.pending) {
    const { number: _n, ...rest } = patch; // el número lo asigna el servidor al enviarlo
    await outbox.enqueuePatch(order.id, rest);
    void outbox.flush();
    return undefined;
  }
  return api.orders.patch(order.id, patch, order.revision);
}

/** Pantalla Ventas: borrado lógico de cualquier pedido. Si aún no llegó al servidor, simplemente desaparece. */
export async function deleteAnyOrder(order: ConfirmedOrder): Promise<void> {
  await outbox.enqueueDelete(order.id);
  void outbox.flush();
}

/**
 * Descarta un pedido pendiente de sincronizar (decisión del dueño, SPEC §8.1): solo si aún no ha
 * llegado al servidor. Devuelve false si ya se envió (o se está enviando).
 */
export async function discardPendingOrder(order: ConfirmedOrder): Promise<{ discarded: boolean; reason?: "synced" | "sending" }> {
  if (!order.pending) return { discarded: false, reason: "synced" };
  return outbox.discardPendingCreate(order.id);
}
