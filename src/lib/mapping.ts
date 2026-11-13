import type { ApiCategory, ApiOrder, ApiOrderItem, ApiProduct, CreateOrderBody } from "@/lib/api/types";
import type { Category, ConfirmedOrder, MenuItem, OrderItem } from "@/types/order";

// ───────────── dinero: euros con ≤2 decimales, cálculos en céntimos ─────────────
export const toCents = (euros: number) => Math.round((Number.isFinite(euros) ? euros : 0) * 100);
export const fromCents = (cents: number) => cents / 100;
/** Redondea a céntimos (lo que acepta el servidor: máximo 2 decimales). */
export const roundMoney = (euros: number) => fromCents(toCents(euros));

export const itemsTotal = (items: Pick<OrderItem, "price" | "quantity">[]) =>
  fromCents(items.reduce((sum, i) => sum + toCents(i.price) * i.quantity, 0));

// ───────────── líneas ─────────────
/** Una línea se identifica por (id, isHalfPortion): completa y media del mismo plato son distintas. */
export const sameLine = (a: Pick<OrderItem, "id" | "isHalfPortion">, b: Pick<OrderItem, "id" | "isHalfPortion">) =>
  a.id === b.id && !!a.isHalfPortion === !!b.isHalfPortion;
export const lineKey = (item: Pick<OrderItem, "id" | "isHalfPortion">) =>
  `${item.id}-${item.isHalfPortion ? "media" : "completa"}`;

const UNKNOWN_PREFIX = "n:";

export function itemFromWire(i: ApiOrderItem, imageFallback = ""): OrderItem {
  return {
    id: i.productId ?? `${UNKNOWN_PREFIX}${i.name}`,
    name: i.name,
    ...(i.names && Object.keys(i.names).length ? { names: i.names } : {}),
    price: i.unitPrice,
    listPrice: i.listPrice ?? undefined,
    image: i.imageUrl ?? imageFallback,
    quantity: i.quantity,
    isHalfPortion: i.half,
  };
}

export function itemToWire(i: OrderItem): CreateOrderBody["items"][number] {
  return {
    productId: i.id.startsWith(UNKNOWN_PREFIX) ? null : i.id,
    name: i.name,
    ...(i.names && i.names.ar ? { names: i.names } : {}),
    unitPrice: roundMoney(i.price),
    listPrice: i.listPrice === undefined ? null : roundMoney(i.listPrice),
    quantity: i.quantity,
    half: !!i.isHalfPortion,
  };
}

// ───────────── catálogo ─────────────
export const categoryFromApi = (c: ApiCategory): Category => ({
  id: c.id,
  name: c.name,
  names: c.names ?? {},
  displayOrder: c.position,
});

export const productFromApi = (p: ApiProduct): MenuItem => ({
  id: p.id,
  name: p.name,
  names: p.names ?? {},
  price: p.price,
  image: p.imageUrl,
  category: p.categoryId,
  portionType: p.portionType,
  halfPortionPrice: p.halfPortionPrice ?? undefined,
  displayOrder: p.position,
  available: p.available,
});

// ───────────── pedidos ─────────────
export function orderFromApi(o: ApiOrder): ConfirmedOrder {
  return {
    id: o.id,
    orderNumber: o.number,
    items: o.items.map((i) => itemFromWire(i)),
    total: o.total,
    date: new Date(o.createdAt),
    status: o.status,
    paymentMethod: o.paymentMethod,
    amountReceived: o.amountReceived,
    change: o.change,
    revision: o.revision,
  };
}

/** Texto del número: definitivo "#5" o provisional "P-1". */
export const orderLabel = (o: Pick<ConfirmedOrder, "pending" | "provisionalNumber" | "orderNumber">) =>
  o.pending ? `P-${o.provisionalNumber ?? "?"}` : `#${o.orderNumber}`;
