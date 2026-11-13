import { describe, it, expect, vi } from "vitest";
import {
  loadStorage,
  makeOrder,
  seedLegacyOrders,
  seedLegacyProducts,
  seedLegacyCategories,
} from "./helpers";
import { menuItems as defaults } from "@/data/menu-items";

const lsSnapshot = () =>
  Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]));

async function backendKind() {
  const { getBackend } = await import("@/lib/storage");
  return (await getBackend()).kind;
}

describe("migración localStorage → IndexedDB", () => {
  it("usa IndexedDB como backend principal", async () => {
    expect(await backendKind()).toBe("indexeddb");
  });

  it("migra pedidos, productos y categorías conservando contenido y orden", async () => {
    const orders = [3, 2, 1].map((n) =>
      makeOrder({ id: `o${n}`, orderNumber: n, date: new Date(`2025-02-0${n}T10:00:00Z`) }),
    );
    const products = [
      { id: "b", name: "B", price: 1, image: "", category: "bebidas", portionType: "unidades", displayOrder: 1 },
      { id: "a", name: "A", price: 2, image: "", category: "postres", portionType: "unidades", displayOrder: 0 },
    ];
    const cats = [
      { id: "postres", name: "Postres", displayOrder: 2 },
      { id: "bebidas", name: "Bebidas", displayOrder: 1 },
    ];
    seedLegacyOrders(orders);
    seedLegacyProducts(products);
    seedLegacyCategories(cats);

    const { orders: o, products: p } = await loadStorage();
    expect(await o.getOrders()).toEqual(orders);
    expect(await p.getProducts()).toEqual(products);
    expect(await p.getCategories()).toEqual(cats);
  });

  it("NO borra ni modifica localStorage (queda como respaldo)", async () => {
    seedLegacyOrders([makeOrder({ id: "x" })]);
    seedLegacyProducts([{ id: "p", name: "P", price: 1, image: "", category: "bebidas", portionType: "unidades" }]);
    const before = lsSnapshot();
    const { orders } = await loadStorage();
    await orders.getOrders();
    expect(lsSnapshot()).toEqual(before);
  });

  it("después de migrar, las escrituras nuevas van a IndexedDB y no a localStorage", async () => {
    seedLegacyOrders([makeOrder({ id: "old", orderNumber: 1 })]);
    const before = lsSnapshot();
    const { orders } = await loadStorage();
    await orders.saveOrder(makeOrder({ id: "new", orderNumber: 2 }));
    expect(lsSnapshot()).toEqual(before);
    expect((await orders.getOrders()).map((x) => x.id)).toEqual(["new", "old"]);
  });

  it("es idempotente: reabrir NO duplica ni revierte cambios posteriores", async () => {
    seedLegacyOrders([makeOrder({ id: "a", orderNumber: 1 }), makeOrder({ id: "b", orderNumber: 2 })]);
    const first = await loadStorage();
    await first.orders.deleteOrder("a"); // el cambio post-migración debe sobrevivir
    vi.resetModules();
    const second = await loadStorage();
    expect((await second.orders.getOrders()).map((o) => o.id)).toEqual(["b"]);
  });

  it("dos aperturas simultáneas migran una sola vez sin duplicados", async () => {
    seedLegacyOrders([1, 2, 3].map((n) => makeOrder({ id: `o${n}`, orderNumber: n })));
    const [a, b] = await Promise.all([loadStorage(), loadStorage()]);
    const [la, lb] = await Promise.all([a.orders.getOrders(), b.orders.getOrders()]);
    expect(la).toHaveLength(3);
    expect(lb).toHaveLength(3);
  });

  it("no resiembra el menú por defecto sobre un menú personalizado migrado", async () => {
    seedLegacyProducts([{ id: "mine", name: "Mío", price: 1, image: "", category: "bebidas", portionType: "unidades" }]);
    const { products } = await loadStorage();
    expect((await products.getProducts()).map((p) => p.id)).toEqual(["mine"]);
  });

  it("si el usuario vació el menú antes de migrar, sigue vacío", async () => {
    seedLegacyProducts([]);
    const { products } = await loadStorage();
    expect(await products.getProducts()).toEqual([]);
  });

  it("sin datos antiguos: siembra defaults una sola vez", async () => {
    const a = await loadStorage();
    expect((await a.products.getProducts()).length).toBe(defaults.length);
    for (const p of await a.products.getProducts()) await a.products.deleteProduct(p.id);
    vi.resetModules();
    const b = await loadStorage();
    expect(await b.products.getProducts()).toEqual([]);
  });

  it("JSON corrupto en un campo no impide migrar el resto", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.setItem("confirmed_orders", "{no es json");
    seedLegacyProducts([{ id: "ok", name: "OK", price: 1, image: "", category: "bebidas", portionType: "unidades" }]);
    const { orders, products } = await loadStorage();
    expect(await orders.getOrders()).toEqual([]);
    expect((await products.getProducts()).map((p) => p.id)).toEqual(["ok"]);
    expect(localStorage.getItem("confirmed_orders")).toBe("{no es json"); // el original se conserva
    expect(err).toHaveBeenCalled();
  });

  it("ignora entradas inválidas (sin id) pero migra las válidas", async () => {
    localStorage.setItem(
      "confirmed_orders",
      JSON.stringify([null, 5, { foo: 1 }, makeOrder({ id: "good", orderNumber: 9 })]),
    );
    const { orders } = await loadStorage();
    expect((await orders.getOrders()).map((o) => o.id)).toEqual(["good"]);
  });

  it("migra un volumen grande (cercano al límite de localStorage) sin perder pedidos", async () => {
    const pad = "x".repeat(1500);
    const many = Array.from({ length: 2000 }, (_, i) =>
      makeOrder({
        id: `h${i}`,
        orderNumber: 2000 - i,
        items: [{ ...makeOrder().items[0], name: "Paella " + pad }],
      }),
    );
    seedLegacyOrders(many);
    const { orders } = await loadStorage();
    const got = await orders.getOrders();
    expect(got).toHaveLength(2000);
    expect(got[0].id).toBe("h0");
    expect(got.at(-1)!.id).toBe("h1999");
    expect(await orders.getNextOrderNumber()).toBe(2001);
  }, 60_000);

  it("las ediciones conservan la posición del pedido en la lista", async () => {
    const { orders } = await loadStorage();
    for (const n of [1, 2, 3]) await orders.saveOrder(makeOrder({ id: `o${n}`, orderNumber: n }));
    await orders.updateOrderStatus("o2", "cancelado");
    expect((await orders.getOrders()).map((o) => o.id)).toEqual(["o3", "o2", "o1"]);
  });
});

describe("fallback si IndexedDB no está disponible", () => {
  it("usa localStorage y la app sigue funcionando igual que antes", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    (globalThis as any).indexedDB = undefined;
    expect(await backendKind()).toBe("localstorage");
    vi.resetModules();
    const { orders } = await loadStorage();
    await orders.saveOrder(makeOrder({ id: "fb", orderNumber: 1 }));
    expect((await orders.getOrders()).map((o) => o.id)).toEqual(["fb"]);
    expect(JSON.parse(localStorage.getItem("confirmed_orders")!)[0].id).toBe("fb");
  });

  it("si abrir IndexedDB falla, cae a localStorage", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    (globalThis as any).indexedDB = {
      open() {
        const r: any = {};
        setTimeout(() => {
          r.error = new Error("boom");
          r.onerror?.();
        });
        return r;
      },
    };
    expect(await backendKind()).toBe("localstorage");
  });
});
