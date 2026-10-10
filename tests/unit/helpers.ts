import type { ConfirmedOrder, OrderItem } from "@/types/order";

export function makeItem(over: Partial<OrderItem> = {}): OrderItem {
  return {
    id: "1",
    name: "Paella Valenciana",
    price: 4.5,
    image: "/paella-valenciana.jpg",
    quantity: 1,
    category: "arroces",
    portionType: "racion",
    halfPortionPrice: 3,
    ...over,
  };
}

export function makeOrder(over: Partial<ConfirmedOrder> = {}): ConfirmedOrder {
  const items = over.items ?? [makeItem()];
  return {
    id: crypto.randomUUID(),
    orderNumber: 1,
    items,
    total: items.reduce((s, i) => s + i.price * i.quantity, 0),
    date: new Date("2025-03-10T12:30:00.000Z"),
    status: "completado",
    paymentMethod: "efectivo",
    ...over,
  };
}

/** Escribe datos en el formato EXACTO que producía la versión con localStorage. */
export function seedLegacyOrders(orders: ConfirmedOrder[]) {
  localStorage.setItem("confirmed_orders", JSON.stringify(orders));
}
export function seedLegacyProducts(products: unknown[]) {
  localStorage.setItem("menu_products", JSON.stringify(products));
}
export function seedLegacyCategories(categories: unknown[]) {
  localStorage.setItem("menu_categories", JSON.stringify(categories));
}

/** Importa los módulos de almacenamiento "como si la app acabara de arrancar". */
export async function loadStorage() {
  const orders = await import("@/lib/order-storage");
  const products = await import("@/lib/product-storage");
  return { orders, products };
}
