import { describe, it, expect, vi } from "vitest";
import { boot, makeItem, makeOrder } from "./helpers";
import type { ConfirmedOrder, OrderItem } from "@/types/order";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());
const paella = (over: Partial<OrderItem> = {}) => makeItem({ id: "1", ...over });
const arroz = (over: Partial<OrderItem> = {}) =>
  makeItem({ id: "2", name: "Arroz de marisco", price: 10, listPrice: 10, ...over });

async function create(app: Awaited<ReturnType<typeof boot>>, items: OrderItem[], extra: any = {}) {
  const saved = await app.orders.saveOrder({ items, paymentMethod: "efectivo", ...extra });
  await saved.settled;
  return saved.id;
}
const get = async (app: Awaited<ReturnType<typeof boot>>, id: string) =>
  (await app.orders.getOrdersForDay(today())).orders.find((o) => o.id === id)!;

describe("reglas de edición desde la caja (SPEC §8)", () => {
  it("solo se pueden editar los pedidos en_proceso", async () => {
    const { rules } = await boot();
    expect(rules.canEditFromRegister({ status: "en_proceso" })).toBe(true);
    expect(rules.canEditFromRegister({ status: "completado" })).toBe(false);
    expect(rules.canEditFromRegister({ status: "cancelado" })).toBe(false);
  });

  it("transiciones permitidas: en_proceso → completado | cancelado, y ninguna más", async () => {
    const { rules } = await boot();
    expect(rules.allowedTransitions({ status: "en_proceso" })).toEqual(["completado", "cancelado"]);
    expect(rules.allowedTransitions({ status: "completado" })).toEqual([]);
    expect(rules.allowedTransitions({ status: "cancelado" })).toEqual([]);
  });

  it("completado y cancelado: updateOrder y updateOrderStatus lanzan y no encolan nada", async () => {
    const app = await boot();
    const doneId = await create(app, [paella()]);
    const cancelledId = await create(app, [paella()], { status: "en_proceso" });
    await app.orders.updateOrderStatus(await get(app, cancelledId), "cancelado");
    await app.outbox.flush();

    for (const id of [doneId, cancelledId]) {
      const order = await get(app, id);
      await expect(app.orders.updateOrder(order, { paymentMethod: "bizum" })).rejects.toThrow(/en proceso/);
      await expect(app.orders.updateOrder(order, { items: [paella({ quantity: 2 })] })).rejects.toThrow();
      await expect(app.orders.updateOrderStatus(order, "en_proceso")).rejects.toThrow(/en proceso|Transición no permitida/);
      await expect(app.orders.updateOrderStatus(order, "completado")).rejects.toThrow();
    }
    expect(await app.outbox.listPending()).toEqual([]);
  });

  it("en_proceso: se editan líneas, cantidades, precio unitario y forma de pago", async () => {
    const app = await boot();
    const id = await create(app, [paella({ quantity: 1 })], { status: "en_proceso" });
    const order = await get(app, id);
    await app.orders.updateOrder(order, {
      items: [paella({ quantity: 3, price: 4 }), arroz({ quantity: 1 })],
      paymentMethod: "bizum",
    });
    await app.outbox.flush();
    const server = app.api.liveOrders()[0];
    expect(server.paymentMethod).toBe("bizum");
    expect(server.items.map((i) => [i.productId, i.quantity, i.unitPrice, i.listPrice])).toEqual([
      ["1", 3, 4, 4.5], // precio ajustado: unitPrice ≠ listPrice
      ["2", 1, 10, 10],
    ]);
    const after = await get(app, id);
    expect(after.total).toBe(22);
    expect(after.status).toBe("en_proceso");
  });

  it("no se puede dejar un pedido sin artículos", async () => {
    const app = await boot();
    const id = await create(app, [paella()], { status: "en_proceso" });
    await expect(app.orders.updateOrder(await get(app, id), { items: [] })).rejects.toThrow(/al menos un artículo/);
    await expect(app.orders.saveOrder({ items: [], paymentMethod: "efectivo" })).rejects.toThrow(/al menos un artículo/);
  });

  it.each(["completado", "cancelado"] as const)("en_proceso → %s funciona y entonces queda en solo lectura", async (to) => {
    const app = await boot();
    const id = await create(app, [paella()], { status: "en_proceso" });
    await app.orders.updateOrderStatus(await get(app, id), to);
    await app.outbox.flush();
    const order = await get(app, id);
    expect(order.status).toBe(to);
    expect(app.rules.canEditFromRegister(order)).toBe(false);
  });

  it("borrar un en_proceso llega al servidor como borrado lógico", async () => {
    const app = await boot();
    const id = await create(app, [paella()], { status: "en_proceso" });
    await app.orders.deleteAnyOrder(await get(app, id));
    await app.outbox.flush();
    expect(app.api.liveOrders()).toEqual([]);
    expect(app.api.orders[0].deletedAt).not.toBeNull();
    expect((await app.orders.getOrdersForDay(today())).orders).toEqual([]);
  });
});

describe("anti doble toque", () => {
  it("dos confirmaciones simultáneas del mismo intento crean un solo pedido", async () => {
    const app = await boot();
    const id = crypto.randomUUID();
    const input = { id, items: [paella()], paymentMethod: "efectivo" as const };
    const [a, b] = await Promise.all([app.orders.saveOrder(input), app.orders.saveOrder(input)]);
    await Promise.all([a.settled, b.settled]);
    await app.outbox.flush();
    expect(app.api.liveOrders()).toHaveLength(1);
    expect(app.api.log.filter((l) => l.method === "POST" && l.path === "/v1/orders").length).toBeGreaterThanOrEqual(1);
  });
});

describe("vistas e historial", () => {
  it("un pedido en la cola se ve de inmediato con indicador pendiente y número provisional", async () => {
    const app = await boot();
    app.ctl.down = true;
    const saved = await app.orders.saveOrder({ items: [paella({ quantity: 2 })], paymentMethod: "tarjeta" });
    const { orders, offline } = await app.orders.getOrdersForDay(today());
    expect(offline).toBe(true);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({
      id: saved.id,
      pending: true,
      provisionalNumber: 1,
      orderNumber: 0,
      total: 9,
      status: "completado",
      paymentMethod: "tarjeta",
    });
    expect(orders[0].items[0].image).toBe("/paella-valenciana.jpg");
  });

  it("sin conexión el historial y el resumen solo contienen los pendientes locales", async () => {
    const app = await boot();
    await create(app, [paella()]); // ya confirmado en el servidor
    app.ctl.down = true;
    const pendingId = (await app.orders.saveOrder({ items: [arroz()], paymentMethod: "bizum" })).id;
    const hist = await app.orders.getOrdersForDay(today());
    expect(hist.offline).toBe(true);
    expect(hist.orders.map((o) => o.id)).toEqual([pendingId]);
    const summary = await app.orders.getDailySummary(today());
    expect(summary.offline).toBe(true);
    expect(summary.report).toMatchObject({ orders: 1, total: 10, byPaymentMethod: { bizum: 10, efectivo: 0, tarjeta: 0 } });
    expect(summary.pendingCount).toBe(1);
  });

  it("online: los pendientes se superponen a los del servidor (sin duplicar al confirmarse)", async () => {
    const app = await boot();
    await create(app, [paella()]);
    app.ctl.down = true;
    await (await app.orders.saveOrder({ items: [arroz()], paymentMethod: "bizum" })).settled;
    app.ctl.down = false;
    // hay un create pendiente y la red vuelve, pero aún no se ha procesado la cola
    let released: () => void = () => {};
    const gate = new Promise<void>((r) => (released = r));
    const original = app.api.handle.bind(app.api);
    app.api.handle = async (req) => (req.method === "POST" && req.url === "/v1/orders" ? (await gate, original(req)) : original(req));
    const { orders, offline } = await app.orders.getOrdersForDay(today());
    expect(offline).toBe(false);
    expect(orders.map((o) => o.pending ?? false).sort()).toEqual([false, true]);
    released();
  });

  it("las ediciones pendientes de un pedido del servidor se ven aplicadas con aviso", async () => {
    const app = await boot();
    const id = await create(app, [paella()], { status: "en_proceso" });
    const order = await get(app, id);
    app.ctl.down = true;
    await app.orders.updateOrder(order, { items: [paella({ quantity: 5 })], paymentMethod: "bizum" });
    await app.outbox.flush();
    app.ctl.down = false;
    app.api.intercept = (req) => (req.method === "PATCH" ? { status: 503, body: { code: "internal_error", message: "x" } } : undefined);
    const view = await get(app, id);
    expect(view).toMatchObject({ total: 22.5, paymentMethod: "bizum", hasPendingChanges: true });
  });

  it("un borrado pendiente oculta el pedido", async () => {
    const app = await boot();
    const id = await create(app, [paella()], { status: "en_proceso" });
    const order = await get(app, id);
    app.ctl.down = true;
    await app.orders.deleteAnyOrder(order);
    await app.outbox.flush();
    app.ctl.down = false;
    app.api.intercept = (req) => (req.method === "DELETE" ? { status: 503, body: { code: "internal_error", message: "x" } } : undefined);
    expect((await app.orders.getOrdersForDay(today())).orders).toEqual([]);
  });

  it("getOrderDays: solo los días con pedidos (servidor + pendientes)", async () => {
    const app = await boot();
    const old = new Date("2025-03-10T12:00:00Z");
    await (await app.orders.saveOrder({ items: [paella()], paymentMethod: "efectivo", date: old })).settled;
    await create(app, [paella()]);
    app.ctl.down = true;
    await (
      await app.orders.saveOrder({ items: [paella()], paymentMethod: "efectivo", date: new Date("2025-04-01T10:00:00Z") })
    ).settled;
    app.ctl.down = false;
    const { days, offline } = await app.orders.getOrderDays();
    expect(offline).toBe(false);
    expect(days).toEqual([today(), "2025-04-01", "2025-03-10"]);
    app.ctl.down = true;
    expect((await app.orders.getOrderDays()).days).toEqual(["2025-04-01"]);
  });

  it("el día de negocio se calcula en Europe/Madrid: 23:30Z de verano cae en el día siguiente", async () => {
    const app = await boot();
    await (await app.orders.saveOrder({ items: [paella()], paymentMethod: "efectivo", date: new Date("2025-07-01T23:30:00Z") })).settled;
    expect(app.api.orders[0].businessDay).toBe("2025-07-02");
    expect((await app.orders.getOrdersForDay("2025-07-02")).orders).toHaveLength(1);
    expect((await app.orders.getOrdersForDay("2025-07-01")).orders).toHaveLength(0);
  });

  it("la numeración se reinicia cada día de negocio", async () => {
    const app = await boot();
    for (const d of ["2025-03-10T10:00:00Z", "2025-03-10T11:00:00Z", "2025-03-11T10:00:00Z"])
      await (await app.orders.saveOrder({ items: [paella()], paymentMethod: "efectivo", date: new Date(d) })).settled;
    expect(app.api.orders.map((o) => [o.businessDay, o.number])).toEqual([
      ["2025-03-10", 1],
      ["2025-03-10", 2],
      ["2025-03-11", 1],
    ]);
  });
});

describe("resumen del día", () => {
  it("viene del servidor: cancelados fuera de ingresos, con línea de anulados y desglose por método de pago", async () => {
    const app = await boot();
    await create(app, [paella({ quantity: 2 })], { paymentMethod: "efectivo" }); // 9.00
    await (await app.orders.saveOrder({ items: [arroz()], paymentMethod: "tarjeta" })).settled; // 10.00
    const cancelled = await create(app, [arroz({ quantity: 10 })], { status: "en_proceso", paymentMethod: "bizum" });
    await app.orders.updateOrderStatus(await get(app, cancelled), "cancelado");
    await app.outbox.flush();

    const { report, offline, pendingCount } = await app.orders.getDailySummary(today());
    expect(offline).toBe(false);
    expect(pendingCount).toBe(0);
    expect(report).toMatchObject({
      orders: 2,
      units: 3,
      total: 19,
      byPaymentMethod: { efectivo: 9, tarjeta: 10, bizum: 0 },
      cancelled: { orders: 1, total: 100 },
    });
    expect(report.byProduct.map((p) => p.name)).not.toContain("x");
    expect(app.api.log.some((l) => l.path === "/v1/reports/daily")).toBe(true);
  });

  it("summarizeOrders (modo sin conexión) aplica las mismas reglas que el servidor", async () => {
    const { orders } = await boot();
    const list: ConfirmedOrder[] = [
      makeOrder({ status: "completado", items: [paella({ quantity: 2 })] }),
      makeOrder({ status: "en_proceso", paymentMethod: "bizum", items: [paella({ quantity: 1 }), paella({ quantity: 1, price: 3, isHalfPortion: true })] }),
      makeOrder({ status: "cancelado", items: [arroz({ quantity: 10 })] }),
    ];
    const r = orders.summarizeOrders("2025-03-10", list);
    expect(r).toMatchObject({
      orders: 2,
      units: 4,
      total: 16.5,
      byPaymentMethod: { efectivo: 9, bizum: 7.5, tarjeta: 0 },
      cancelled: { orders: 1, total: 100 },
    });
    expect(r.byProduct.map((p) => [p.name, p.half, p.quantity, p.total])).toEqual([
      ["Paella Valenciana", false, 3, 13.5],
      ["Paella Valenciana", true, 1, 3],
    ]);
  });

  it("los cálculos en céntimos evitan errores de coma flotante", async () => {
    const { orders } = await boot();
    const r = orders.summarizeOrders("2025-03-10", [
      makeOrder({ items: [paella({ price: 0.1, quantity: 3 })] }),
      makeOrder({ items: [paella({ price: 0.2, quantity: 1 })] }),
    ]);
    expect(r.total).toBe(0.5);
  });
});

describe("mapeo de pedidos del servidor", () => {
  it("una línea sin productId se conserva y se reenvía con productId null", async () => {
    const app = await boot();
    const { itemFromWire, itemToWire } = await import("@/lib/mapping");
    const item = itemFromWire({ productId: null, name: "Plato borrado", unitPrice: 3, listPrice: null, quantity: 2, half: false });
    expect(item.id).toBe("n:Plato borrado");
    expect(itemToWire(item)).toMatchObject({ productId: null, name: "Plato borrado", unitPrice: 3, listPrice: null });
    void app;
  });

  it("completa y media del mismo plato son líneas distintas", async () => {
    const { sameLine, lineKey } = await import("@/lib/mapping");
    const full = paella();
    const half = paella({ isHalfPortion: true });
    expect(sameLine(full, half)).toBe(false);
    expect(sameLine(full, paella({ isHalfPortion: false }))).toBe(true);
    expect(lineKey(full)).not.toBe(lineKey(half));
    vi.fn();
  });
});

describe("descartar pendientes, añadir líneas y correcciones (SPEC §8.1)", () => {
  it("discardPendingOrder elimina la entrada create sin dejar rastro; no se ofrece para pedidos ya sincronizados", async () => {
    const app = await boot();
    app.ctl.down = true;
    const saved = await app.orders.saveOrder({ items: [paella()], paymentMethod: "efectivo" });
    await saved.settled;
    const [pending] = await app.orders.getPendingOrders();
    expect(pending).toMatchObject({ id: saved.id, pending: true });
    expect(await app.orders.discardPendingOrder(pending)).toEqual({ discarded: true });
    expect(await app.outbox.listPending()).toEqual([]);
    expect(await app.outbox.listFailed()).toEqual([]);
    app.ctl.down = false;
    await app.outbox.flush();
    expect(app.api.orders).toHaveLength(0);

    // ya sincronizado: no es pendiente y no se puede descartar
    const id = await create(app, [paella()]);
    const synced = await get(app, id);
    expect(await app.orders.discardPendingOrder(synced)).toEqual({ discarded: false, reason: "synced" });
    expect(await app.outbox.discardPendingCreate(id)).toEqual({ discarded: false, reason: "synced" });
    expect(app.api.orders).toHaveLength(1);
  });

  it("descartar también elimina las ediciones encoladas sobre el mismo pedido pendiente", async () => {
    const app = await boot();
    app.ctl.down = true;
    const saved = await app.orders.saveOrder({ items: [paella()], paymentMethod: "efectivo", status: "en_proceso" });
    await saved.settled;
    const [pending] = await app.orders.getPendingOrders();
    await app.orders.updateOrder(pending, { paymentMethod: "bizum", items: [paella({ quantity: 3 }), arroz()] });
    expect(await app.outbox.listPending()).toHaveLength(1); // fundido en el create
    expect((await app.orders.getPendingOrders())[0].items).toHaveLength(2);
    await app.orders.discardPendingOrder((await app.orders.getPendingOrders())[0]);
    expect(await app.outbox.listPending()).toEqual([]);
  });

  it("no se descarta un pedido cuya creación se está enviando (en vuelo)", async () => {
    const app = await boot();
    app.ctl.hang = true; // la petición no responde: el create queda en vuelo
    const saved = await app.orders.saveOrder({ items: [paella()], paymentMethod: "efectivo" });
    await new Promise((r) => setTimeout(r, 50));
    expect(await app.outbox.discardPendingCreate(saved.id)).toEqual({ discarded: false, reason: "sending" });
    expect(await app.outbox.listPending()).toHaveLength(1);
    app.ctl.hang = false;
    app.outbox._reset();
  });

  it("añadir un producto a un pedido en proceso: PATCH con la lista completa y If-Match; completado no se puede", async () => {
    const app = await boot();
    const id = await create(app, [paella()], { status: "en_proceso" });
    const order = await get(app, id);
    await app.orders.updateOrder(order, { items: [...order.items, arroz({ id: "2", price: 4.5, listPrice: 4.5, isHalfPortion: true })] });
    await app.outbox.flush();
    const o = app.api.orders.find((x) => x.id === id)!;
    expect(o.items.map((i) => [i.productId, i.half])).toEqual([["1", false], ["2", true]]);
    expect(app.api.log.filter((l) => l.method === "PATCH").at(-1)!.headers["if-match"]).toBe('"1"');
    const done = await get(app, await create(app, [paella()]));
    await expect(app.orders.updateOrder(done, { items: [paella(), arroz()] })).rejects.toThrow();
  });

  it("correctOrder (Ventas) corrige cualquier campo de un pedido completado directamente en el servidor, con If-Match", async () => {
    const app = await boot();
    const id = await create(app, [paella()]);
    const order = await get(app, id);
    const updated = await app.orders.correctOrder(order, { status: "cancelado", paymentMethod: "tarjeta", number: 7 });
    expect(updated).toMatchObject({ status: "cancelado", paymentMethod: "tarjeta", number: 7, revision: 2 });
    // revisión desfasada → 412 revision_mismatch
    await expect(app.orders.correctOrder(order, { paymentMethod: "bizum" })).rejects.toMatchObject({ code: "revision_mismatch" });
  });

  it("getInProcessOrders devuelve los en_proceso del servidor más los pendientes locales, y solo esos", async () => {
    const app = await boot();
    await create(app, [paella()]);
    const a = await create(app, [paella()], { status: "en_proceso" });
    app.ctl.down = true;
    const p = await app.orders.saveOrder({ items: [arroz()], paymentMethod: "efectivo", status: "en_proceso" });
    await p.settled;
    const off = await app.orders.getInProcessOrders();
    expect(off.offline).toBe(true);
    expect(off.orders.map((o) => o.id)).toEqual([p.id]);
    app.ctl.down = false;
    await app.outbox.flush();
    const on = await app.orders.getInProcessOrders();
    expect(on.orders.map((o) => o.id).sort()).toEqual([a, p.id].sort());
  });
});
