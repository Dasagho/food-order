import type { Category, ConfirmedOrder, MenuItem } from "@/types/order";
import type { Backend } from "./types";
import {
  LS_CATEGORIES,
  LS_ORDERS,
  LS_PRODUCTS,
  readLegacyArray,
} from "./legacy-keys";

/** Implementación idéntica al comportamiento histórico. Solo se usa como fallback. */
export function createLocalStorageBackend(): Backend {
  const orders = (): ConfirmedOrder[] =>
    (readLegacyArray<any>(LS_ORDERS) ?? []).map((o) => ({
      ...o,
      date: new Date(o.date),
    }));
  const write = (key: string, v: unknown) =>
    localStorage.setItem(key, JSON.stringify(v));
  const upsert = <T extends { id: string }>(key: string, item: T) => {
    const list = readLegacyArray<T>(key) ?? [];
    const i = list.findIndex((x) => x.id === item.id);
    if (i >= 0) list[i] = item;
    else list.push(item);
    write(key, list);
  };

  return {
    kind: "localstorage",
    async listOrders() {
      return orders();
    },
    async addOrder(order) {
      write(LS_ORDERS, [order, ...orders()]);
    },
    async removeOrder(id) {
      write(LS_ORDERS, orders().filter((o) => o.id !== id));
    },
    async patchOrder(id, patch) {
      write(LS_ORDERS, orders().map((o) => (o.id === id ? patch(o) : o)));
    },
    async maxOrderNumber() {
      return Math.max(0, ...orders().map((o) => o.orderNumber));
    },
    async listProducts() {
      return readLegacyArray<MenuItem>(LS_PRODUCTS) ?? [];
    },
    async upsertProduct(p) {
      upsert(LS_PRODUCTS, p);
    },
    async removeProduct(id) {
      const list = readLegacyArray<MenuItem>(LS_PRODUCTS) ?? [];
      write(LS_PRODUCTS, list.filter((p) => p.id !== id));
    },
    async replaceProducts(list) {
      write(LS_PRODUCTS, list);
    },
    async listCategories() {
      return readLegacyArray<Category>(LS_CATEGORIES) ?? [];
    },
    async upsertCategory(c) {
      upsert(LS_CATEGORIES, c);
    },
    async removeCategory(id) {
      const list = readLegacyArray<Category>(LS_CATEGORIES) ?? [];
      write(LS_CATEGORIES, list.filter((c) => c.id !== id));
    },
    async seedDefaults(products, categories) {
      if (localStorage.getItem(LS_PRODUCTS) === null) write(LS_PRODUCTS, products);
      if (localStorage.getItem(LS_CATEGORIES) === null)
        write(LS_CATEGORIES, categories);
    },
  };
}
