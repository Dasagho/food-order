import { vi } from "vitest";
import { FakeApi, TEST_SEED, type FakeRequest } from "../fake-api/fake-api";
import type { ConfirmedOrder, OrderItem } from "@/types/order";

export function makeItem(over: Partial<OrderItem> = {}): OrderItem {
  return {
    id: "1",
    name: "Paella Valenciana",
    price: 4.5,
    listPrice: 4.5,
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

// ───────────── servidor falso conectado a fetch ─────────────
export interface ServerControls {
  /** Simula que no hay red: fetch lanza TypeError sin llegar al servidor. */
  down: boolean;
  /** El servidor PROCESA la petición pero la respuesta se pierde (el cliente ve un fallo de red). */
  dropResponses: number;
  /** La petición no responde nunca (hasta que el cliente la aborta por timeout). */
  hang: boolean;
  /** Número de llamadas a fetch que llegaron a salir. */
  calls: number;
}

/**
 * Sustituye `fetch` por el FAKE del servidor (contrato de SPEC.md). Devuelve el fake
 * (para inspeccionar su estado y registro de peticiones) y los controles de fallo.
 */
export function installServer(api: FakeApi = new FakeApi(TEST_SEED)) {
  const ctl: ServerControls = { down: false, dropResponses: 0, hang: false, calls: 0 };
  const fetchMock = vi.fn(async (input: any, init: any = {}) => {
    ctl.calls++;
    const signal: AbortSignal | undefined = init.signal;
    const abortError = () => Object.assign(new Error("aborted"), { name: "AbortError" });
    if (signal?.aborted) throw abortError();
    if (ctl.down) throw new TypeError("Failed to fetch");
    if (ctl.hang) {
      await new Promise((_, reject) => signal?.addEventListener("abort", () => reject(abortError())));
    }
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(init.headers ?? {})) headers[k.toLowerCase()] = String(v);
    let body: unknown = undefined;
    if (typeof init.body === "string") body = JSON.parse(init.body);
    else if (init.body instanceof FormData) body = { file: init.body.get("file") };
    const req: FakeRequest = { method: init.method ?? "GET", url: String(input).replace(/^https?:\/\/[^/]+/, ""), headers, body };
    const res = await api.handle(req);
    if (ctl.dropResponses > 0) {
      ctl.dropResponses--;
      throw new TypeError("Failed to fetch");
    }
    return new Response(res.body === undefined ? null : JSON.stringify(res.body), {
      status: res.status,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { api, ctl, fetch: fetchMock };
}

/** Inicia sesión "como si ya hubiera hecho login": guarda tokens válidos del fake en IndexedDB. */
export async function signIn(api: FakeApi) {
  const res = await api.handle({ method: "POST", url: "/v1/auth/dev-login", headers: {}, body: {} });
  const tokens = await import("@/lib/auth/tokens");
  const session = tokens.sessionFromResponse(res.body);
  await tokens.saveSession(session);
  return session;
}

/** Importa los módulos de la app "como si acabara de arrancar" (tras vi.resetModules()). */
export async function loadApp() {
  const [orders, products, outbox, tokens, rules] = await Promise.all([
    import("@/lib/order-storage"),
    import("@/lib/product-storage"),
    import("@/lib/sync/outbox"),
    import("@/lib/auth/tokens"),
    import("@/lib/order-rules"),
  ]);
  return { orders, products, outbox, tokens, rules };
}

/** Servidor + sesión + módulos: el arranque típico de un test de integración. */
export async function boot(api?: FakeApi) {
  const server = installServer(api);
  const session = await signIn(server.api);
  const app = await loadApp();
  return { ...server, session, ...app };
}

/** Escribe datos en los almacenes legacy de IndexedDB, con el formato exacto de la PR. */
export async function seedLegacyIdb(data: { orders?: any[]; products?: any[]; categories?: any[] }) {
  const { run } = await import("@/lib/db");
  await run(["orders", "products", "categories"], "readwrite", async (tx) => {
    const orders = data.orders ?? [];
    orders.forEach((o, i) => tx.objectStore("orders").put({ ...o, _pos: orders.length - i }));
    (data.products ?? []).forEach((p, i) => tx.objectStore("products").put({ ...p, _pos: i + 1 }));
    (data.categories ?? []).forEach((c, i) => tx.objectStore("categories").put({ ...c, _pos: i + 1 }));
  });
}

/** Escribe datos en el formato EXACTO que producía la versión con localStorage. */
export function seedLegacyLocalStorage(data: { orders?: unknown[]; products?: unknown[]; categories?: unknown[] }) {
  if (data.orders) localStorage.setItem("confirmed_orders", JSON.stringify(data.orders));
  if (data.products) localStorage.setItem("menu_products", JSON.stringify(data.products));
  if (data.categories) localStorage.setItem("menu_categories", JSON.stringify(data.categories));
}

/** Pedido en el formato de la versión anterior (el que envía el cliente a /import/orders). */
export function legacyOrder(n: number, over: Record<string, unknown> = {}) {
  return {
    id: `legacy-${n}`,
    orderNumber: n,
    items: [
      {
        id: "1",
        name: "Paella Valenciana",
        price: 4.5,
        image: "/paella-valenciana.jpg",
        quantity: 2,
        category: "arroces",
        portionType: "racion",
        halfPortionPrice: 3,
        isHalfPortion: false,
      },
    ],
    total: 9,
    date: new Date("2025-03-10T12:30:00.000Z"),
    status: "completado",
    paymentMethod: "efectivo",
    ...over,
  };
}

export const flushPromises = () => new Promise<void>((r) => setTimeout(r, 0));
