/**
 * FAKE en memoria del backend food-order-api (contrato: food-order-api/SPEC.md).
 * Solo usa sintaxis TypeScript "borrable" para poder ejecutarse también con
 * `node --experimental-strip-types` (servidor de los e2e de Playwright).
 *
 * `handle()` es independiente del transporte: los tests unitarios lo conectan a un
 * `fetch` simulado y los e2e a un servidor HTTP mínimo (tests/fake-api/server.ts).
 */

export interface FakeRequest {
  method: string;
  /** Ruta con query: /v1/orders?date=2026-11-10 */
  url: string;
  headers: Record<string, string>;
  body?: any;
}
export interface FakeResponse {
  status: number;
  body?: any;
}

type Json = any;

const MADRID = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Madrid",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export const madridDay = (iso: string | Date): string => MADRID.format(new Date(iso));

const cents = (n: number) => Math.round(n * 100);
const validAmount = (n: any) =>
  typeof n === "number" && Number.isFinite(n) && n >= 0 && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;

class Reject extends Error {
  res: FakeResponse;
  constructor(status: number, code: string, message: string, extra: Json = {}) {
    super(message);
    this.res = { status, body: { code, message, ...extra } };
  }
}

async function sha256b64url(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  let s = "";
  new Uint8Array(digest).forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

interface StoredCategory {
  id: string;
  name: string;
  names: { ar?: string };
  position: number;
  updatedAt: string;
  deletedAt: string | null;
}
interface StoredProduct {
  id: string;
  name: string;
  names: { ar?: string };
  price: number;
  halfPortionPrice: number | null;
  portionType: "racion" | "unidades";
  categoryId: string;
  imageUrl: string;
  available: boolean;
  position: number;
  updatedAt: string;
  deletedAt: string | null;
}
interface StoredItem {
  productId: string | null;
  name: string;
  names: { ar?: string };
  unitPrice: number;
  listPrice: number | null;
  quantity: number;
  half: boolean;
}
interface StoredOrder {
  id: string;
  number: number;
  businessDay: string;
  status: string;
  paymentMethod: string;
  amountReceived: number | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
  legacyNumber: number | null;
  deletedAt: string | null;
  items: StoredItem[];
}

export interface FakeSeed {
  categories?: { id: string; name: string }[];
  products?: {
    id: string;
    name: string;
    price: number;
    halfPortionPrice?: number;
    image: string;
    category: string;
    portionType: "racion" | "unidades";
    available?: boolean;
    names?: { ar?: string };
  }[];
}

export class FakeApi {
  categories: StoredCategory[] = [];
  products: StoredProduct[] = [];
  orders: StoredOrder[] = [];
  /** Registro de todas las peticiones recibidas (para aserciones). */
  log: { method: string; path: string; query: Record<string, string>; body: Json; headers: Record<string, string> }[] = [];
  /** Gancho para inyectar respuestas (p. ej. 500 o 412) antes de procesar. */
  intercept: ((req: FakeRequest) => FakeResponse | undefined) | null = null;
  accessTtlMs = 15 * 60 * 1000;

  private accessTokens = new Map<string, number>(); // token -> caduca
  private refreshTokens = new Set<string>();
  private codes = new Map<string, string>(); // code -> challenge
  private counter = 0;
  private clock: () => number;

  constructor(seed: FakeSeed = {}, clock: () => number = () => Date.now()) {
    this.clock = clock;
    const now = new Date(this.clock()).toISOString();
    (seed.categories ?? []).forEach((c, i) =>
      this.categories.push({ id: c.id, name: c.name, names: {}, position: i, updatedAt: now, deletedAt: null }),
    );
    (seed.products ?? []).forEach((p, i) =>
      this.products.push({
        id: p.id,
        name: p.name,
        names: p.names ?? {},
        price: p.price,
        halfPortionPrice: p.portionType === "racion" ? (p.halfPortionPrice ?? null) : null,
        portionType: p.portionType,
        categoryId: p.category,
        imageUrl: p.image,
        available: p.available ?? true,
        position: i,
        updatedAt: now,
        deletedAt: null,
      }),
    );
  }

  // ───────── utilidades de test ─────────
  /** Caduca todos los access tokens (el siguiente uso da 401 y obliga a refrescar). */
  expireAccessTokens() {
    this.accessTokens.clear();
  }
  revokeAllRefreshTokens() {
    this.refreshTokens.clear();
  }
  /** Simula que otro dispositivo añade/edita datos. */
  liveOrders() {
    return this.orders.filter((o) => !o.deletedAt);
  }
  countRequests(method: string, pathPrefix: string) {
    return this.log.filter((l) => l.method === method && l.path.startsWith(pathPrefix)).length;
  }

  private issue() {
    const accessToken = `acc-${++this.counter}`;
    const refreshToken = `ref-${++this.counter}`;
    this.accessTokens.set(accessToken, this.clock() + this.accessTtlMs);
    this.refreshTokens.add(refreshToken);
    return {
      accessToken,
      refreshToken,
      expiresIn: Math.floor(this.accessTtlMs / 1000),
      user: { email: "dueno@ejemplo.es", name: "Dueño" },
    };
  }

  /** Código de un solo uso como el que deja el callback de Microsoft. */
  issueLoginCode(challenge: string): string {
    const code = `code-${++this.counter}`;
    this.codes.set(code, challenge);
    return code;
  }

  // ───────── serialización ─────────
  private orderJson(o: StoredOrder): Json {
    const total = o.items.reduce((s, i) => s + cents(i.unitPrice) * i.quantity, 0) / 100;
    const change =
      o.paymentMethod === "efectivo" && o.amountReceived !== null
        ? Math.round((o.amountReceived - total) * 100) / 100
        : null;
    return {
      id: o.id,
      number: o.number,
      businessDay: o.businessDay,
      status: o.status,
      paymentMethod: o.paymentMethod,
      total,
      amountReceived: o.amountReceived,
      change,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
      revision: o.revision,
      legacyNumber: o.legacyNumber,
      deletedAt: o.deletedAt,
      items: o.items.map((i) => ({
        ...i,
        imageUrl: this.products.find((p) => p.id === i.productId && !p.deletedAt)?.imageUrl ?? null,
      })),
    };
  }

  private nextNumber(day: string): number {
    return this.orders.filter((o) => o.businessDay === day).reduce((m, o) => Math.max(m, o.number), 0) + 1;
  }

  private parseItems(raw: any, existing: StoredItem[] = []): StoredItem[] {
    if (!Array.isArray(raw) || raw.length < 1 || raw.length > 100)
      throw new Reject(400, "validation_error", "items: de 1 a 100 líneas", { field: "items" });
    return raw.map((i: any) => {
      if (!i || typeof i.name !== "string" || !i.name)
        throw new Reject(400, "validation_error", "name obligatorio", { field: "items.name" });
      if (!Number.isInteger(i.quantity) || i.quantity < 1 || i.quantity > 99)
        throw new Reject(400, "validation_error", "quantity 1..99", { field: "items.quantity" });
      if (!validAmount(i.unitPrice))
        throw new Reject(400, "invalid_amount", "unitPrice no válido", { field: "items.unitPrice" });
      if (i.listPrice != null && !validAmount(i.listPrice))
        throw new Reject(400, "invalid_amount", "listPrice no válido", { field: "items.listPrice" });
      let listPrice: number | null = i.listPrice ?? null;
      const product = i.productId ? this.products.find((p) => p.id === i.productId) : undefined;
      if (listPrice === null && product && product.portionType === "racion")
        listPrice = i.half ? (product.halfPortionPrice ?? product.price) : product.price;
      void existing;
      return {
        productId: i.productId ?? null,
        name: i.name,
        names: i.names ?? {},
        unitPrice: i.unitPrice,
        listPrice,
        quantity: i.quantity,
        half: !!i.half,
      };
    });
  }

  // ───────── enrutado ─────────
  async handle(req: FakeRequest): Promise<FakeResponse> {
    const [path, qs = ""] = req.url.split("?");
    const query: Record<string, string> = Object.fromEntries(new URLSearchParams(qs));
    this.log.push({ method: req.method, path, query, body: req.body, headers: req.headers });
    const injected = this.intercept?.(req);
    if (injected) return injected;
    try {
      return await this.route(req, path, query);
    } catch (e) {
      if (e instanceof Reject) return e.res;
      throw e;
    }
  }

  private authorize(req: FakeRequest) {
    const h = req.headers["authorization"] ?? "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : "";
    const exp = this.accessTokens.get(token);
    if (!exp || exp < this.clock()) throw new Reject(401, "unauthorized", "Token no válido o caducado");
  }

  private async route(req: FakeRequest, path: string, query: Record<string, string>): Promise<FakeResponse> {
    const m = req.method;
    const body = req.body ?? {};
    if (path === "/health") return { status: 200, body: { status: "ok" } };

    // ── auth ──
    if (path === "/v1/auth/exchange" && m === "POST") {
      const challenge = this.codes.get(body.code);
      this.codes.delete(body.code); // un solo uso
      if (!challenge || typeof body.verifier !== "string" || (await sha256b64url(body.verifier)) !== challenge)
        throw new Reject(400, "validation_error", "Código o verificador no válidos");
      return { status: 200, body: this.issue() };
    }
    if (path === "/v1/auth/dev-login" && m === "POST") return { status: 200, body: this.issue() };
    if (path === "/v1/auth/refresh" && m === "POST") {
      if (!this.refreshTokens.has(body.refreshToken)) throw new Reject(401, "unauthorized", "Refresh no válido");
      this.refreshTokens.delete(body.refreshToken); // rotativo
      return { status: 200, body: this.issue() };
    }
    if (path === "/v1/auth/logout" && m === "POST") {
      this.authorize(req); // como el real: /auth/logout exige Bearer (SPEC §3)
      this.refreshTokens.delete(body.refreshToken);
      return { status: 204 };
    }
    if (path.startsWith("/v1/uploads/") && m === "GET") return { status: 200, body: "" };

    this.authorize(req);
    if (path === "/v1/auth/me") return { status: 200, body: { email: "dueno@ejemplo.es", name: "Dueño" } };

    // ── categorías ──
    if (path === "/v1/categories" && m === "GET") {
      return { status: 200, body: this.categories.filter((c) => !c.deletedAt).sort((a, b) => a.position - b.position) };
    }
    if (path === "/v1/categories/reorder" && m === "POST") return this.reorder(this.categories, body.ids);
    if (path === "/v1/categories" && m === "POST") {
      if (!body?.name || typeof body.name !== "string") throw new Reject(400, "validation_error", "Falta name");
      const now = new Date(this.clock()).toISOString();
      const live = this.categories.filter((c) => !c.deletedAt);
      const c: StoredCategory = {
        id: `c-${++this.counter}`,
        name: body.name,
        names: body.names ?? {},
        position: live.length ? Math.max(...live.map((x) => x.position)) + 1 : 0,
        updatedAt: now,
        deletedAt: null,
      };
      this.categories.push(c);
      return { status: 201, body: c };
    }
    const cat = path.match(/^\/v1\/categories\/([^/]+)$/);
    if (cat) {
      const id = decodeURIComponent(cat[1]);
      const found = this.categories.find((c) => c.id === id && !c.deletedAt);
      if (!found) throw new Reject(404, "not_found", "Categoría no encontrada");
      const now = new Date(this.clock()).toISOString();
      if (m === "PATCH") {
        if (body.name !== undefined) found.name = body.name;
        if (body.names !== undefined) found.names = body.names;
        found.updatedAt = now;
        return { status: 200, body: found };
      }
      if (m === "DELETE") {
        if (this.products.some((p) => p.categoryId === id && !p.deletedAt))
          throw new Reject(409, "category_not_empty", "La categoría tiene productos");
        found.deletedAt = now;
        found.updatedAt = now;
        return { status: 204 };
      }
    }

    // ── productos ──
    if (path === "/v1/products" && m === "GET") {
      const all = query.includeDeleted === "true" ? this.products : this.products.filter((p) => !p.deletedAt);
      return { status: 200, body: [...all].sort((a, b) => a.position - b.position) };
    }
    if (path === "/v1/products/reorder" && m === "POST") return this.reorder(this.products, body.ids);
    if (path === "/v1/products" && m === "POST") {
      const p = this.writeProduct(null, body);
      return { status: 201, body: p };
    }
    const prod = path.match(/^\/v1\/products\/([^/]+)$/);
    if (prod) {
      const id = decodeURIComponent(prod[1]);
      const found = this.products.find((p) => p.id === id && !p.deletedAt);
      if (!found) throw new Reject(404, "not_found", "Producto no encontrado");
      if (m === "PATCH") return { status: 200, body: this.writeProduct(found, body) };
      if (m === "DELETE") {
        found.deletedAt = new Date(this.clock()).toISOString();
        found.updatedAt = found.deletedAt;
        return { status: 204 };
      }
    }
    if (path === "/v1/uploads" && m === "POST") {
      return { status: 201, body: { url: `/v1/uploads/img-${++this.counter}.png` } };
    }

    // ── pedidos ──
    if (path === "/v1/orders" && m === "POST") return this.createOrder(body);
    if (path === "/v1/orders" && m === "GET") return this.listOrders(query);
    if (path === "/v1/orders/days" && m === "GET") {
      const counts = new Map<string, number>();
      this.liveOrders().forEach((o) => counts.set(o.businessDay, (counts.get(o.businessDay) ?? 0) + 1));
      const days = [...counts.entries()]
        .filter(([d]) => (!query.from || d >= query.from) && (!query.to || d <= query.to))
        .sort((a, b) => b[0].localeCompare(a[0]))
        .map(([day, count]) => ({ day, count }));
      return { status: 200, body: days };
    }
    const ord = path.match(/^\/v1\/orders\/([^/]+)$/);
    if (ord) {
      const id = decodeURIComponent(ord[1]);
      const o = this.orders.find((x) => x.id === id);
      if (m === "GET") {
        if (!o || o.deletedAt) throw new Reject(404, "not_found", "Pedido no encontrado");
        return { status: 200, body: this.orderJson(o) };
      }
      if (m === "PATCH") return this.patchOrder(o, body, req.headers["if-match"]);
      if (m === "DELETE") {
        if (!o) throw new Reject(404, "not_found", "Pedido no encontrado");
        if (!o.deletedAt) {
          o.deletedAt = new Date(this.clock()).toISOString();
          o.updatedAt = o.deletedAt;
          o.revision++;
        }
        return { status: 204 };
      }
    }

    // ── informes ──
    if (path === "/v1/reports/daily" && m === "GET") return { status: 200, body: this.dailyReport(query.from, query.to) };

    // ── importación ──
    if (path === "/v1/import/catalog" && m === "POST") return this.importCatalog(body);
    if (path === "/v1/import/orders" && m === "POST") return this.importOrders(body);

    throw new Reject(404, "not_found", `Ruta desconocida: ${m} ${path}`);
  }

  private reorder(list: { id: string; position: number; deletedAt: string | null }[], ids: any): FakeResponse {
    const live = list.filter((x) => !x.deletedAt);
    if (
      !Array.isArray(ids) ||
      ids.length !== live.length ||
      new Set(ids).size !== ids.length ||
      !live.every((x) => ids.includes(x.id))
    )
      throw new Reject(409, "reorder_mismatch", "La lista no coincide exactamente con los elementos actuales");
    ids.forEach((id: string, i: number) => (list.find((x) => x.id === id)!.position = i));
    return { status: 204 };
  }

  private writeProduct(existing: StoredProduct | null, b: Json): StoredProduct {
    const now = new Date(this.clock()).toISOString();
    for (const f of ["price", "halfPortionPrice"])
      if (b[f] != null && !validAmount(b[f])) throw new Reject(400, "invalid_amount", `${f} no válido`, { field: f });
    if (!existing) {
      if (!b.name || !b.categoryId || !b.portionType || b.price === undefined || b.imageUrl === undefined)
        throw new Reject(400, "validation_error", "Faltan campos obligatorios");
      const p: StoredProduct = {
        id: `p-${++this.counter}`,
        name: b.name,
        names: b.names ?? {},
        price: b.price,
        halfPortionPrice: b.portionType === "racion" ? (b.halfPortionPrice ?? null) : null,
        portionType: b.portionType,
        categoryId: b.categoryId,
        imageUrl: b.imageUrl,
        available: b.available ?? true,
        position: this.products.reduce((m, x) => Math.max(m, x.position), -1) + 1,
        updatedAt: now,
        deletedAt: null,
      };
      this.products.push(p);
      return p;
    }
    const next = { ...existing, ...b, updatedAt: now };
    for (const k of Object.keys(b))
      if (!["name", "names", "price", "halfPortionPrice", "portionType", "categoryId", "imageUrl", "available"].includes(k))
        throw new Reject(400, "validation_error", `Campo desconocido: ${k}`, { field: k });
    if (next.portionType === "unidades") next.halfPortionPrice = null;
    Object.assign(existing, next);
    return existing;
  }

  private createOrder(b: Json): FakeResponse {
    if (typeof b.id !== "string" || !b.id) throw new Reject(400, "validation_error", "id obligatorio", { field: "id" });
    const dup = this.orders.find((o) => o.id === b.id);
    if (dup) return { status: 200, body: this.orderJson(dup) };
    const createdAt = new Date(b.createdAt);
    if (Number.isNaN(createdAt.getTime())) throw new Reject(400, "validation_error", "createdAt no válido", { field: "createdAt" });
    if (createdAt.getTime() > this.clock() + 5 * 60_000)
      throw new Reject(422, "validation_error", "createdAt está en el futuro", { field: "createdAt" });
    const status = b.status ?? "completado";
    const paymentMethod = b.paymentMethod ?? "efectivo";
    if (!["en_proceso", "completado", "cancelado"].includes(status))
      throw new Reject(400, "validation_error", "status no válido", { field: "status" });
    if (!["efectivo", "tarjeta", "bizum"].includes(paymentMethod))
      throw new Reject(400, "validation_error", "paymentMethod no válido", { field: "paymentMethod" });
    if (b.amountReceived != null && !validAmount(b.amountReceived))
      throw new Reject(400, "invalid_amount", "amountReceived no válido", { field: "amountReceived" });
    const items = this.parseItems(b.items);
    const day = madridDay(createdAt);
    const now = new Date(this.clock()).toISOString();
    const o: StoredOrder = {
      id: b.id,
      number: this.nextNumber(day),
      businessDay: day,
      status,
      paymentMethod,
      amountReceived: b.amountReceived ?? null,
      createdAt: createdAt.toISOString(),
      updatedAt: now,
      revision: 1,
      legacyNumber: null,
      deletedAt: null,
      items,
    };
    this.orders.push(o);
    return { status: 201, body: this.orderJson(o) };
  }

  private patchOrder(o: StoredOrder | undefined, b: Json, ifMatch: string | undefined): FakeResponse {
    if (!o || o.deletedAt) throw new Reject(404, "not_found", "Pedido no encontrado");
    if (ifMatch !== undefined && ifMatch.replace(/"/g, "") !== String(o.revision))
      throw new Reject(412, "revision_mismatch", "El pedido cambió en el servidor", { order: this.orderJson(o) });
    if (b.status !== undefined) {
      if (!["en_proceso", "completado", "cancelado"].includes(b.status))
        throw new Reject(400, "validation_error", "status no válido", { field: "status" });
      o.status = b.status;
    }
    if (b.paymentMethod !== undefined) {
      if (!["efectivo", "tarjeta", "bizum"].includes(b.paymentMethod))
        throw new Reject(400, "validation_error", "paymentMethod no válido", { field: "paymentMethod" });
      o.paymentMethod = b.paymentMethod;
    }
    if (b.amountReceived !== undefined) {
      if (b.amountReceived !== null && !validAmount(b.amountReceived))
        throw new Reject(400, "invalid_amount", "amountReceived no válido", { field: "amountReceived" });
      o.amountReceived = b.amountReceived;
    }
    if (b.items !== undefined) o.items = this.parseItems(b.items, o.items);
    if (b.createdAt !== undefined) {
      const d = new Date(b.createdAt);
      if (Number.isNaN(d.getTime())) throw new Reject(400, "validation_error", "createdAt no válido", { field: "createdAt" });
      const day = madridDay(d);
      o.createdAt = d.toISOString();
      if (day !== o.businessDay && b.number === undefined) {
        o.businessDay = day;
        o.number = this.nextNumber(day);
      }
    }
    if (b.number !== undefined) {
      if (this.orders.some((x) => x !== o && x.businessDay === o.businessDay && x.number === b.number))
        throw new Reject(409, "number_taken", "Ese número ya está en uso ese día");
      o.number = b.number;
    }
    o.revision++;
    o.updatedAt = new Date(this.clock()).toISOString();
    return { status: 200, body: this.orderJson(o) };
  }

  private listOrders(q: Record<string, string>): FakeResponse {
    const from = q.date ?? q.from;
    const to = q.date ?? q.to;
    let list = this.orders.filter((o) => (q.includeDeleted === "true" ? true : !o.deletedAt));
    if (from) list = list.filter((o) => o.businessDay >= from);
    if (to) list = list.filter((o) => o.businessDay <= to);
    if (q.status) list = list.filter((o) => o.status === q.status);
    if (q.paymentMethod) list = list.filter((o) => o.paymentMethod === q.paymentMethod);
    list.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.number - a.number);
    const limit = Math.min(Number(q.limit ?? 500), 1000);
    const start = q.cursor ? Number(q.cursor) : 0;
    const page = list.slice(start, start + limit);
    const next = start + limit < list.length ? String(start + limit) : null;
    return { status: 200, body: { items: page.map((o) => this.orderJson(o)), nextCursor: next } };
  }

  private dailyReport(from: string, to: string): Json[] {
    const days = new Map<string, StoredOrder[]>();
    this.orders
      .filter((o) => !o.deletedAt && (!from || o.businessDay >= from) && (!to || o.businessDay <= to))
      .forEach((o) => days.set(o.businessDay, [...(days.get(o.businessDay) ?? []), o]));
    return [...days.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, list]) => {
        const rep: Json = {
          day,
          orders: 0,
          units: 0,
          total: 0,
          byPaymentMethod: { efectivo: 0, tarjeta: 0, bizum: 0 },
          byProduct: [],
          cancelled: { orders: 0, total: 0 },
        };
        let total = 0;
        let cancelled = 0;
        const method: Record<string, number> = { efectivo: 0, tarjeta: 0, bizum: 0 };
        const prods = new Map<string, Json>();
        for (const o of list) {
          const oc = this.orderJson(o).total * 100;
          if (o.status === "cancelado") {
            rep.cancelled.orders++;
            cancelled += Math.round(oc);
            continue;
          }
          rep.orders++;
          total += Math.round(oc);
          method[o.paymentMethod] += Math.round(oc);
          for (const i of o.items) {
            rep.units += i.quantity;
            const key = `${i.productId ?? i.name}|${i.half}`;
            const row = prods.get(key) ?? { productId: i.productId, name: i.name, names: i.names, half: i.half, quantity: 0, totalC: 0 };
            row.quantity += i.quantity;
            row.totalC += cents(i.unitPrice) * i.quantity;
            prods.set(key, row);
          }
        }
        rep.total = total / 100;
        rep.cancelled.total = cancelled / 100;
        for (const k of Object.keys(method)) rep.byPaymentMethod[k] = method[k] / 100;
        rep.byProduct = [...prods.values()].map(({ totalC, ...r }) => ({ ...r, total: totalC / 100 }));
        return rep;
      });
  }

  /** Como el real: 200 con {created, updated, skipped, errors:[{id,reason}]}; imagen y categoría obligatorias. */
  private importCatalog(b: Json): FakeResponse {
    const now = new Date(this.clock()).toISOString();
    const result = { created: 0, updated: 0, skipped: 0, errors: [] as { id: string; reason: string }[] };
    (b.categories ?? []).forEach((c: any) => {
      result.created++;
      const found = this.categories.find((x) => x.id === c.id);
      if (found) Object.assign(found, { name: c.name, position: c.displayOrder ?? found.position, updatedAt: now, deletedAt: null });
      else
        this.categories.push({ id: c.id, name: c.name, names: {}, position: c.displayOrder ?? this.categories.length, updatedAt: now, deletedAt: null });
    });
    (b.products ?? []).forEach((p: any, i: number) => {
      if (!p.image) return void result.errors.push({ id: p.id, reason: "Falta image." });
      if (!this.categories.some((c) => c.id === p.category && !c.deletedAt))
        return void result.errors.push({ id: p.id, reason: `La categoría «${p.category}» no existe.` });
      if (!validAmount(p.price)) return void result.errors.push({ id: p.id, reason: "price no válido" });
      result.created++;
      const next = {
        name: p.name,
        price: p.price,
        halfPortionPrice: p.portionType === "racion" ? (p.halfPortionPrice ?? null) : null,
        portionType: p.portionType,
        categoryId: p.category,
        imageUrl: p.image,
        position: p.displayOrder ?? i,
        updatedAt: now,
        deletedAt: null,
      };
      const found = this.products.find((x) => x.id === p.id);
      if (found) Object.assign(found, next);
      else this.products.push({ id: p.id, names: {}, available: true, ...next } as StoredProduct);
    });
    return { status: 200, body: result };
  }

  private importOrders(b: Json): FakeResponse {
    const result = { created: 0, skipped: 0, errors: [] as { id: string; reason: string }[] };
    const list: any[] = [...(b.orders ?? [])].sort((x, y) => new Date(x.date).getTime() - new Date(y.date).getTime());
    for (const o of list) {
      if (this.orders.some((x) => x.id === o.id)) {
        result.skipped++;
        continue;
      }
      const d = new Date(o.date);
      if (Number.isNaN(d.getTime()) || !Array.isArray(o.items) || o.items.length === 0) {
        result.errors.push({ id: o.id, reason: "datos no válidos" });
        continue;
      }
      const day = madridDay(d);
      const now = new Date(this.clock()).toISOString();
      this.orders.push({
        id: o.id,
        number: this.nextNumber(day),
        businessDay: day,
        status: o.status ?? "completado",
        paymentMethod: o.paymentMethod ?? "efectivo",
        amountReceived: null,
        createdAt: d.toISOString(),
        updatedAt: now,
        revision: 1,
        legacyNumber: o.orderNumber ?? null,
        deletedAt: null,
        items: o.items.map((i: any) => ({
          productId: i.id ?? null,
          name: i.name,
          names: {},
          unitPrice: i.price,
          listPrice: i.isHalfPortion ? (i.halfPortionPrice ?? null) : null,
          quantity: i.quantity,
          half: !!i.isHalfPortion,
        })),
      });
      result.created++;
    }
    return { status: 200, body: result };
  }
}

/** Menú pequeño y estable para los tests. */
export const TEST_SEED: FakeSeed = {
  categories: [
    { id: "arroces", name: "Arroces y Paellas" },
    { id: "entrantes", name: "Entrantes" },
    { id: "principales", name: "Platos Principales" },
    { id: "bebidas", name: "Bebidas" },
    { id: "postres", name: "Postres" },
  ],
  products: [
    { id: "1", name: "Paella Valenciana", price: 4.5, halfPortionPrice: 3, image: "/paella-valenciana.jpg", category: "arroces", portionType: "racion" },
    { id: "2", name: "Arroz de marisco", price: 4.5, halfPortionPrice: 3, image: "/arroz-de-marisco.jpg", category: "arroces", portionType: "racion" },
    { id: "3", name: "Croqueta de jamón", price: 1.5, image: "/croqueta-de-jamon.jpg", category: "entrantes", portionType: "unidades" },
    { id: "4", name: "Lata de refresco", price: 2, image: "/lata-de-refresco.jpg", category: "bebidas", portionType: "unidades" },
  ],
};
