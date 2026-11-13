import { describe, it, expect, vi } from "vitest";
import { loadStorage, makeOrder, makeItem, seedLegacyOrders } from "./helpers";

describe("order-storage", () => {
  it("devuelve [] cuando no hay pedidos", async () => {
    const { orders } = await loadStorage();
    expect(await orders.getOrders()).toEqual([]);
  });

  it("saveOrder añade el pedido nuevo al principio (más reciente primero)", async () => {
    const { orders } = await loadStorage();
    const a = makeOrder({ id: "a", orderNumber: 1 });
    const b = makeOrder({ id: "b", orderNumber: 2 });
    await orders.saveOrder(a);
    await orders.saveOrder(b);
    const list = await orders.getOrders();
    expect(list.map((o) => o.id)).toEqual(["b", "a"]);
  });

  it("getOrders devuelve `date` como objeto Date con el mismo instante", async () => {
    const { orders } = await loadStorage();
    const date = new Date("2025-06-01T08:15:30.000Z");
    await orders.saveOrder(makeOrder({ id: "d", date }));
    const [o] = await orders.getOrders();
    expect(o.date).toBeInstanceOf(Date);
    expect(o.date.getTime()).toBe(date.getTime());
  });

  it("conserva todos los campos del pedido (items, método de pago, estado, total)", async () => {
    const { orders } = await loadStorage();
    const order = makeOrder({
      id: "full",
      orderNumber: 7,
      status: "en_proceso",
      paymentMethod: "bizum",
      items: [
        makeItem({ id: "1", quantity: 2 }),
        makeItem({ id: "2", name: "Media", price: 3, isHalfPortion: true, quantity: 1 }),
      ],
    });
    await orders.saveOrder(order);
    const [got] = await orders.getOrders();
    expect(got).toEqual(order);
  });

  it("los datos persisten tras reiniciar la app (recarga de módulos)", async () => {
    const first = await loadStorage();
    await first.orders.saveOrder(makeOrder({ id: "p1" }));
    vi.resetModules();
    const second = await loadStorage();
    expect((await second.orders.getOrders()).map((o) => o.id)).toEqual(["p1"]);
  });

  it("deleteOrder elimina solo el pedido indicado", async () => {
    const { orders } = await loadStorage();
    await orders.saveOrder(makeOrder({ id: "a" }));
    await orders.saveOrder(makeOrder({ id: "b" }));
    await orders.deleteOrder("a");
    expect((await orders.getOrders()).map((o) => o.id)).toEqual(["b"]);
  });

  it("deleteOrder con id inexistente no rompe ni borra nada", async () => {
    const { orders } = await loadStorage();
    await orders.saveOrder(makeOrder({ id: "a" }));
    await orders.deleteOrder("zzz");
    expect(await orders.getOrders()).toHaveLength(1);
  });

  it("updateOrderStatus cambia solo el estado del pedido objetivo", async () => {
    const { orders } = await loadStorage();
    await orders.saveOrder(makeOrder({ id: "a", status: "completado" }));
    await orders.saveOrder(makeOrder({ id: "b", status: "completado" }));
    await orders.updateOrderStatus("a", "cancelado");
    const byId = Object.fromEntries((await orders.getOrders()).map((o) => [o.id, o]));
    expect(byId.a.status).toBe("cancelado");
    expect(byId.b.status).toBe("completado");
  });

  it("updateOrder reemplaza los items y recalcula el total", async () => {
    const { orders } = await loadStorage();
    await orders.saveOrder(makeOrder({ id: "a" }));
    await orders.updateOrder("a", [
      makeItem({ id: "1", price: 4.5, quantity: 2 }),
      makeItem({ id: "9", price: 1.25, quantity: 4 }),
    ]);
    const [o] = await orders.getOrders();
    expect(o.items).toHaveLength(2);
    expect(o.total).toBeCloseTo(14);
  });

  it("updateOrder no modifica estado, número ni método de pago", async () => {
    const { orders } = await loadStorage();
    await orders.saveOrder(
      makeOrder({ id: "a", orderNumber: 42, status: "en_proceso", paymentMethod: "tarjeta" }),
    );
    await orders.updateOrder("a", [makeItem({ quantity: 3 })]);
    const [o] = await orders.getOrders();
    expect(o).toMatchObject({ orderNumber: 42, status: "en_proceso", paymentMethod: "tarjeta" });
  });

  describe("getNextOrderNumber", () => {
    it("es 1 sin pedidos", async () => {
      const { orders } = await loadStorage();
      expect(await orders.getNextOrderNumber()).toBe(1);
    });

    it("es el máximo + 1, no la cantidad de pedidos", async () => {
      const { orders } = await loadStorage();
      await orders.saveOrder(makeOrder({ id: "a", orderNumber: 5 }));
      await orders.saveOrder(makeOrder({ id: "b", orderNumber: 3 }));
      expect(await orders.getNextOrderNumber()).toBe(6);
    });

    it("avanza con cada pedido guardado en secuencia", async () => {
      const { orders } = await loadStorage();
      for (let i = 0; i < 5; i++) {
        const n = await orders.getNextOrderNumber();
        expect(n).toBe(i + 1);
        await orders.saveOrder(makeOrder({ id: `o${i}`, orderNumber: n }));
      }
    });
  });

  it("guardados concurrentes no pierden pedidos", async () => {
    const { orders } = await loadStorage();
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        Promise.resolve(orders.saveOrder(makeOrder({ id: `c${i}`, orderNumber: i + 1 }))),
      ),
    );
    expect(await orders.getOrders()).toHaveLength(10);
  });

  it("lee correctamente pedidos escritos por la versión antigua (compatibilidad de formato)", async () => {
    seedLegacyOrders([
      makeOrder({ id: "old2", orderNumber: 2, date: new Date("2025-01-02T10:00:00Z") }),
      makeOrder({ id: "old1", orderNumber: 1, date: new Date("2025-01-01T10:00:00Z") }),
    ]);
    const { orders } = await loadStorage();
    const list = await orders.getOrders();
    expect(list.map((o) => o.id)).toEqual(["old2", "old1"]);
    expect(list[0].date).toBeInstanceOf(Date);
    expect(await orders.getNextOrderNumber()).toBe(3);
  });
});
