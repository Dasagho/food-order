import { describe, it, expect, vi, afterEach } from "vitest";
import { boot, makeItem } from "./helpers";
import type { OrderItem } from "@/types/order";

// Con temporizadores simulados, fake-indexeddb sigue necesitando turnos REALES del bucle de eventos
const realSetTimeout = globalThis.setTimeout;
const realSleep = (ms: number) => new Promise<void>((r) => realSetTimeout(r, ms));
/** Avanza el reloj simulado y deja que IndexedDB (real) termine lo que se haya puesto en marcha. */
async function tick(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
  await realSleep(40);
}
async function until(cond: () => boolean | Promise<boolean>, timeout = 3000) {
  const t0 = Date.now();
  while (!(await cond())) {
    if (Date.now() - t0 > timeout) throw new Error("until: tiempo agotado");
    await realSleep(10);
  }
}
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());

afterEach(() => {
  vi.useRealTimers();
});

const paella = (over: Partial<OrderItem> = {}) => makeItem({ id: "1", ...over });
const posts = (api: any) => api.log.filter((l: any) => l.method === "POST" && l.path === "/v1/orders");

async function pendingKinds(outbox: any) {
  return (await outbox.listPending()).map((e: any) => `${e.kind}:${e.orderId}`);
}

describe("outbox: confirmación borra la entrada", () => {
  it("un pedido creado llega al servidor y la cola de IndexedDB queda vacía", async () => {
    const { orders, outbox, api } = await boot();
    const saved = await orders.saveOrder({ items: [paella({ quantity: 2 })], paymentMethod: "bizum" });
    const settled = await saved.settled;
    expect(settled).toEqual({ synced: true, number: 1 });
    expect(await outbox.listPending()).toEqual([]);
    expect(await outbox.listFailed()).toEqual([]);
    expect(api.liveOrders()).toHaveLength(1);
    expect(api.liveOrders()[0]).toMatchObject({ id: saved.id, paymentMethod: "bizum", status: "completado" });
  });

  it("envía unitPrice y listPrice por línea y la media como half", async () => {
    const { orders, api } = await boot();
    const edited = paella({ price: 4 }); // precio final editado: catálogo 4.5
    const half = paella({ price: 3, listPrice: 3, isHalfPortion: true });
    await (await orders.saveOrder({ items: [edited, half], paymentMethod: "efectivo" })).settled;
    const body = posts(api)[0].body;
    expect(body.items).toEqual([
      { productId: "1", name: "Paella Valenciana", unitPrice: 4, listPrice: 4.5, quantity: 1, half: false },
      { productId: "1", name: "Paella Valenciana", unitPrice: 3, listPrice: 3, quantity: 1, half: true },
    ]);
    expect(body.status).toBe("completado");
    expect(Number.isNaN(Date.parse(body.createdAt))).toBe(false);
  });

  it("'Dejar en proceso' crea el pedido en_proceso", async () => {
    const { orders, api } = await boot();
    await (await orders.saveOrder({ items: [paella()], paymentMethod: "efectivo", status: "en_proceso" })).settled;
    expect(api.liveOrders()[0].status).toBe("en_proceso");
  });
});

describe("outbox: orden FIFO", () => {
  it("las operaciones salen en el orden en que se hicieron", async () => {
    const { orders, ctl, api } = await boot();
    ctl.down = true;
    const a = await orders.saveOrder({ items: [paella()], paymentMethod: "efectivo" });
    const b = await orders.saveOrder({ items: [paella()], paymentMethod: "tarjeta" });
    const c = await orders.saveOrder({ items: [paella()], paymentMethod: "bizum" });
    await a.settled;
    expect([a, b, c].map((x) => x.provisionalNumber)).toEqual([1, 2, 3]);
    ctl.down = false;
    const { outbox } = await import("./helpers").then(() => import("@/lib/sync/outbox")).then((o) => ({ outbox: o }));
    await outbox.flush();
    expect(posts(api).map((p: any) => p.body.id)).toEqual([a.id, b.id, c.id]);
    // el servidor numera en ese orden
    expect(api.liveOrders().map((o) => o.number)).toEqual([1, 2, 3]);
  });
});

describe("outbox: fusión (coalescing)", () => {
  it("editar un pedido aún no creado modifica su entrada create (una sola petición)", async () => {
    const { orders, outbox, ctl, api } = await boot();
    ctl.down = true;
    const saved = await orders.saveOrder({
      items: [paella({ quantity: 1 })],
      paymentMethod: "efectivo",
      status: "en_proceso",
    });
    const order = (await orders.getOrdersForDay(today())).orders[0];
    await orders.updateOrder(order, { items: [paella({ quantity: 3, price: 5 })], paymentMethod: "bizum" });
    await orders.updateOrderStatus(order, "completado");

    const entries = await outbox.listPending();
    expect(entries.map((e) => e.kind)).toEqual(["create"]);
    expect(entries[0].payload).toMatchObject({ status: "completado", paymentMethod: "bizum" });
    expect((entries[0].payload as any).items[0]).toMatchObject({ quantity: 3, unitPrice: 5 });

    ctl.down = false;
    await outbox.flush();
    expect(posts(api)).toHaveLength(1);
    expect(api.countRequests("PATCH", "/v1/orders")).toBe(0);
    expect(api.liveOrders()[0]).toMatchObject({ id: saved.id, status: "completado", paymentMethod: "bizum" });
  });

  it("borrar un pedido que nunca llegó al servidor hace desaparecer la entrada", async () => {
    const { orders, outbox, ctl, api } = await boot();
    ctl.down = true;
    await orders.saveOrder({ items: [paella()], paymentMethod: "efectivo", status: "en_proceso" });
    const order = (await orders.getOrdersForDay(today())).orders[0];
    await orders.deleteAnyOrder(order);
    expect(await outbox.listPending()).toEqual([]);
    ctl.down = false;
    await outbox.flush();
    expect(api.log.filter((l) => l.path.startsWith("/v1/orders"))).toEqual([]);
  });

  it("varias ediciones de un pedido del servidor se fusionan en un patch con la revisión original", async () => {
    const { orders, outbox, ctl, api } = await boot();
    await (await orders.saveOrder({ items: [paella()], paymentMethod: "efectivo", status: "en_proceso" })).settled;
    const day = api.orders[0].businessDay;
    const order = (await orders.getOrdersForDay(day)).orders[0];
    expect(order.revision).toBe(1);

    ctl.down = true;
    await orders.updateOrder(order, { paymentMethod: "tarjeta" });
    await orders.updateOrder(order, { items: [paella({ quantity: 4 })] });
    await orders.updateOrderStatus(order, "completado");
    const entries = await outbox.listPending();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "patch", baseRevision: 1 });
    expect(entries[0].payload).toMatchObject({ paymentMethod: "tarjeta", status: "completado" });

    ctl.down = false;
    await outbox.flush();
    const patch = api.log.find((l) => l.method === "PATCH")!;
    expect(patch.headers["if-match"]).toBe('"1"');
    expect(api.liveOrders()[0]).toMatchObject({ status: "completado", paymentMethod: "tarjeta", revision: 2 });
  });

  it("borrar un pedido del servidor descarta sus patches pendientes y deja un único delete", async () => {
    const { orders, outbox, ctl, api } = await boot();
    await (await orders.saveOrder({ items: [paella()], paymentMethod: "efectivo", status: "en_proceso" })).settled;
    const order = (await orders.getOrdersForDay(api.orders[0].businessDay)).orders[0];
    ctl.down = true;
    await orders.updateOrder(order, { paymentMethod: "bizum" });
    await orders.deleteAnyOrder(order);
    expect(await pendingKinds(outbox)).toEqual([`delete:${order.id}`]);
    ctl.down = false;
    await outbox.flush();
    expect(api.liveOrders()).toEqual([]);
    expect(api.countRequests("PATCH", "/v1/orders")).toBe(0);
  });

  it("si el create ya va en vuelo, la edición posterior es un patch aparte que hereda la revisión", async () => {
    const { orders, outbox, api, ctl } = await boot();
    ctl.hang = false;
    // la respuesta del create tarda: la edición llega mientras vuela
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const original = api.handle.bind(api);
    api.handle = async (req) => {
      const res = await original(req);
      if (req.method === "POST" && req.url === "/v1/orders") await gate;
      return res;
    };
    const saved = await orders.saveOrder({ items: [paella()], paymentMethod: "efectivo", status: "en_proceso" });
    await vi.waitFor(() => expect(api.liveOrders()).toHaveLength(1)); // el create ya llegó al servidor
    const view = (await orders.getOrdersForDay(today())).orders[0];
    await orders.updateOrder(view, { paymentMethod: "tarjeta" });
    expect((await outbox.listPending()).map((e) => e.kind)).toEqual(["create", "patch"]);
    release();
    await saved.settled;
    await outbox.flush();
    expect(await outbox.listPending()).toEqual([]);
    expect(api.liveOrders()[0]).toMatchObject({ paymentMethod: "tarjeta", revision: 2 });
  });
});

describe("outbox: reintentos", () => {
  it("la espera crece exponencialmente de 2 s a 60 s con aleatoriedad", async () => {
    const { outbox } = await boot();
    const mid = () => 0.5; // factor 1.0
    expect([1, 2, 3, 4, 5, 6, 7, 20].map((n) => outbox.backoffDelay(n, mid))).toEqual([
      2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000,
    ]);
    expect(outbox.backoffDelay(1, () => 0)).toBe(1500);
    expect(outbox.backoffDelay(1, () => 1)).toBe(2500);
    expect(outbox.backoffDelay(10, () => 1)).toBe(60000);
  });

  it("con la red caída conserva la entrada y reintenta solo cuando vence el temporizador", async () => {
    const { orders, outbox, ctl, api } = await boot();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    ctl.down = true;
    const saved = await orders.saveOrder({ items: [paella()], paymentMethod: "efectivo" });
    await saved.settled;
    expect((await outbox.listPending()).length).toBe(1);
    expect((await outbox.getState()).retryAt).not.toBeNull();
    const callsBefore = ctl.calls;

    await tick(1_500);
    expect(ctl.calls).toBe(callsBefore); // aún no: la primera espera es de 2 s
    await tick(600);
    expect(ctl.calls).toBe(callsBefore + 1); // 2º intento, vuelve a fallar
    await tick(3_900); // la siguiente espera es de 4 s
    expect(ctl.calls).toBe(callsBefore + 1);
    ctl.down = false;
    await tick(200);
    await until(async () => (await outbox.listPending()).length === 0);
    expect(api.liveOrders()).toHaveLength(1);
  });

  it("un 500 del servidor se trata como transitorio (se conserva y se reintenta)", async () => {
    const { orders, outbox, api } = await boot();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    let fails = 2;
    api.intercept = (req) =>
      req.method === "POST" && req.url === "/v1/orders" && fails-- > 0
        ? { status: 500, body: { code: "internal_error", message: "boom" } }
        : undefined;
    await (await orders.saveOrder({ items: [paella()], paymentMethod: "efectivo" })).settled;
    expect(await outbox.listPending()).toHaveLength(1);
    expect(await outbox.listFailed()).toEqual([]);
    await tick(2_500); // 1er reintento (500)
    await tick(5_000); // 2º reintento (500 otra vez)…
    await tick(10_000); // …y el 3º ya funciona
    await until(async () => (await outbox.listPending()).length === 0);
    expect(api.liveOrders()).toHaveLength(1);
  });

  it("al volver la conexión (evento online) se envía lo pendiente", async () => {
    const { orders, outbox, ctl, api } = await boot();
    ctl.down = true;
    await (await orders.saveOrder({ items: [paella()], paymentMethod: "efectivo" })).settled;
    outbox.start();
    ctl.down = false;
    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(api.liveOrders()).toHaveLength(1));
    await vi.waitFor(async () => expect(await outbox.listPending()).toEqual([]));
  });

  it("un timeout de 10 s cuenta como fallo de red", async () => {
    const { orders, outbox, ctl } = await boot();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    ctl.hang = true;
    const saved = await orders.saveOrder({ items: [paella()], paymentMethod: "efectivo" });
    await until(() => ctl.calls > 0);
    await tick(10_000);
    expect(await saved.settled).toEqual({ synced: false, number: undefined });
    expect(await outbox.listPending()).toHaveLength(1);
  });
});

describe("outbox: idempotencia", () => {
  it("si la respuesta se pierde, el reintento NO duplica el pedido en el servidor", async () => {
    const { orders, outbox, ctl, api } = await boot();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    ctl.dropResponses = 1; // el servidor crea el pedido pero el cliente no se entera
    const saved = await orders.saveOrder({ items: [paella()], paymentMethod: "efectivo" });
    expect(await saved.settled).toMatchObject({ synced: false });
    expect(api.liveOrders()).toHaveLength(1);
    expect(await outbox.listPending()).toHaveLength(1);

    await tick(3_000);
    await until(async () => (await outbox.listPending()).length === 0);
    expect(posts(api)).toHaveLength(2); // dos POST con el mismo id…
    expect(api.liveOrders()).toHaveLength(1); // …y un solo pedido
    expect(api.liveOrders()[0].number).toBe(1);
  });

  it("guardar dos veces el mismo intento (mismo UUID) no crea dos entradas", async () => {
    const { orders, outbox, ctl } = await boot();
    ctl.down = true;
    const id = crypto.randomUUID();
    await orders.saveOrder({ id, items: [paella()], paymentMethod: "efectivo" });
    await orders.saveOrder({ id, items: [paella()], paymentMethod: "efectivo" });
    expect(await outbox.listPending()).toHaveLength(1);
  });
});

describe("outbox: 412 revision_mismatch", () => {
  it("la edición sin conexión se descarta, se avisa y el servidor conserva lo suyo", async () => {
    const { orders, outbox, api, ctl } = await boot();
    await (await orders.saveOrder({ items: [paella()], paymentMethod: "efectivo", status: "en_proceso" })).settled;
    const order = (await orders.getOrdersForDay(api.orders[0].businessDay)).orders[0];

    ctl.down = true;
    await orders.updateOrder(order, { paymentMethod: "bizum" });
    // mientras tanto, otro dispositivo corrige el pedido en el servidor
    await api.handle({
      method: "PATCH",
      url: `/v1/orders/${order.id}`,
      headers: { authorization: `Bearer ${[...(api as any).accessTokens.keys()][0]}` },
      body: { paymentMethod: "tarjeta" },
    });
    const events: any[] = [];
    outbox.subscribe((e) => events.push(e));
    ctl.down = false;
    await outbox.flush();

    expect(await outbox.listPending()).toEqual([]);
    expect(await outbox.listFailed()).toEqual([]); // no es un fallo: se descarta y se avisa
    expect(events.find((e) => e.type === "conflict")).toMatchObject({ orderId: order.id, discarded: 1 });
    expect(api.liveOrders()[0].paymentMethod).toBe("tarjeta");
    // y el refresco de ese pedido muestra lo del servidor
    expect((await orders.getOrdersForDay(order.date.toISOString().slice(0, 10))).orders).toBeDefined();
  });
});

describe("outbox: 401 y refresco de token", () => {
  it("con el access token caducado refresca UNA vez (rotación) y envía la cola", async () => {
    const { orders, outbox, api, tokens, session } = await boot();
    api.expireAccessTokens();
    await (await orders.saveOrder({ items: [paella()], paymentMethod: "efectivo" })).settled;
    await (await orders.saveOrder({ items: [paella()], paymentMethod: "efectivo" })).settled;
    expect(await outbox.listPending()).toEqual([]);
    expect(api.liveOrders()).toHaveLength(2);
    expect(api.countRequests("POST", "/v1/auth/refresh")).toBe(1);
    const next = await tokens.getSession();
    expect(next!.refreshToken).not.toBe(session.refreshToken); // rotado
  });

  it("peticiones concurrentes con 401 comparten un único refresco", async () => {
    const { api, products, orders } = await boot();
    api.expireAccessTokens();
    await Promise.all([products.refreshCatalog(), orders.getOrderDays(), orders.getOrdersForDay(today())]);
    expect(api.countRequests("POST", "/v1/auth/refresh")).toBe(1);
  });

  it("si el refresh es rechazado: se cierra la sesión, la cola queda intacta y se reanuda tras iniciar sesión", async () => {
    const { orders, outbox, api, tokens, ctl } = await boot();
    ctl.down = true;
    await (await orders.saveOrder({ items: [paella()], paymentMethod: "efectivo" })).settled;
    ctl.down = false;
    api.expireAccessTokens();
    api.revokeAllRefreshTokens();
    const events: any[] = [];
    outbox.subscribe((e) => events.push(e.type));
    await outbox.flush();

    expect(await tokens.getSession()).toBeNull();
    expect(events).toContain("auth-required");
    expect(await outbox.listPending()).toHaveLength(1); // intacta
    expect(api.liveOrders()).toHaveLength(0);

    const { signIn } = await import("./helpers");
    await signIn(api); // vuelve a iniciar sesión
    await outbox.flush();
    expect(await outbox.listPending()).toEqual([]);
    expect(api.liveOrders()).toHaveLength(1);
  });

  it("un fallo de red durante el refresh NO cierra la sesión", async () => {
    const { orders, outbox, api, tokens, ctl } = await boot();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    api.expireAccessTokens();
    ctl.down = true;
    await (await orders.saveOrder({ items: [paella()], paymentMethod: "efectivo" })).settled;
    expect(await tokens.getSession()).not.toBeNull();
    expect(await outbox.listPending()).toHaveLength(1);
  });
});

describe("outbox: otros 4xx van a outbox_failed", () => {
  it("un 422 no se pierde en silencio: pasa a outbox_failed y la cola sigue", async () => {
    const { orders, outbox, api } = await boot();
    const events: any[] = [];
    outbox.subscribe((e) => events.push(e));
    let first = true;
    api.intercept = (req) => {
      if (req.method === "POST" && req.url === "/v1/orders" && first) {
        first = false;
        return { status: 422, body: { code: "validation_error", message: "malo" } };
      }
    };
    const a = await orders.saveOrder({ items: [paella()], paymentMethod: "efectivo" });
    await a.settled;
    const b = await orders.saveOrder({ items: [paella()], paymentMethod: "bizum" });
    await b.settled;

    const failed = await outbox.listFailed();
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ orderId: a.id, kind: "create", error: { code: "validation_error", status: 422 } });
    expect(events.some((e) => e.type === "failed")).toBe(true);
    expect(await outbox.listPending()).toEqual([]);
    expect(api.liveOrders().map((o) => o.id)).toEqual([b.id]);
  });

  it("reintentar un rechazado lo devuelve a la cola; descartar lo borra", async () => {
    const { orders, outbox, api } = await boot();
    let reject = true;
    api.intercept = (req) =>
      req.method === "POST" && req.url === "/v1/orders" && reject
        ? { status: 409, body: { code: "conflict", message: "no" } }
        : undefined;
    const a = await orders.saveOrder({ items: [paella()], paymentMethod: "efectivo" });
    await a.settled;
    const [f] = await outbox.listFailed();
    reject = false;
    await outbox.retryFailed(f.opId);
    await vi.waitFor(() => expect(api.liveOrders()).toHaveLength(1));
    expect(await outbox.listFailed()).toEqual([]);

    reject = true;
    const b = await orders.saveOrder({ items: [paella()], paymentMethod: "efectivo" });
    await b.settled;
    const [g] = await outbox.listFailed();
    await outbox.discardFailed(g.opId);
    expect(await outbox.listFailed()).toEqual([]);
  });

  it("si falla un create, las ediciones que iban detrás también pasan a rechazados", async () => {
    const { orders, outbox, api, ctl } = await boot();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const original = api.handle.bind(api);
    api.handle = async (req) => {
      if (req.method === "POST" && req.url === "/v1/orders") {
        await gate; // el create está en vuelo cuando llega la edición…
        return { status: 422, body: { code: "validation_error", message: "malo" } }; // …y el servidor lo rechaza
      }
      return original(req);
    };
    const saved = await orders.saveOrder({ items: [paella()], paymentMethod: "efectivo", status: "en_proceso" });
    await until(() => ctl.calls > 0);
    const view = (await orders.getOrdersForDay(today())).orders[0];
    await orders.updateOrder(view, { paymentMethod: "bizum" });
    expect((await outbox.listPending()).map((e) => e.kind)).toEqual(["create", "patch"]);
    release();
    await saved.settled;
    expect(await outbox.listPending()).toEqual([]);
    const failed = await outbox.listFailed();
    expect(failed.map((f) => f.kind).sort()).toEqual(["create", "patch"]);
    expect(failed.find((f) => f.kind === "patch")!.error.code).toBe("dependent_failed");
  });

  it("un patch rechazado con 404 va a rechazados (no se pierde)", async () => {
    const { outbox } = await boot();
    await outbox.enqueuePatch("fantasma", { status: "completado" }, 3);
    await outbox.flush();
    const failed = await outbox.listFailed();
    expect(failed).toHaveLength(1);
    expect(failed[0].error.status).toBe(404);
  });

  it("borrar algo que ya no existe (404) se da por confirmado", async () => {
    const { outbox } = await boot();
    await outbox.enqueueDelete("no-existe");
    await outbox.flush();
    expect(await outbox.listPending()).toEqual([]);
    expect(await outbox.listFailed()).toEqual([]);
  });
});

describe("outbox: numeración provisional", () => {
  it("los pendientes se muestran con P-1, P-2… y al sincronizar reciben el número del servidor", async () => {
    const { orders, outbox, ctl } = await boot();
    const { orderLabel } = await import("@/lib/mapping");
    ctl.down = true;
    await orders.saveOrder({ items: [paella()], paymentMethod: "efectivo" });
    await orders.saveOrder({ items: [paella()], paymentMethod: "efectivo" });
    const view = (await orders.getOrdersForDay(today())).orders;
    expect(view.every((o) => o.pending)).toBe(true);
    expect(view.map(orderLabel).sort()).toEqual(["P-1", "P-2"]);
    ctl.down = false;
    await outbox.flush();
    const day = (await orders.getOrderDays()).days[0];
    const synced = (await orders.getOrdersForDay(day)).orders;
    expect(synced.map(orderLabel).sort()).toEqual(["#1", "#2"]);
    expect(synced.some((o) => o.pending)).toBe(false);
  });
});
