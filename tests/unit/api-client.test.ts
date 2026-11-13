import { describe, it, expect, vi, afterEach } from "vitest";
import { boot, installServer, signIn } from "./helpers";
import { FakeApi, TEST_SEED } from "../fake-api/fake-api";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("cliente de API", () => {
  it("envía Authorization: Bearer con el access token y la base VITE_API_URL", async () => {
    vi.stubEnv("VITE_API_URL", "https://api.ejemplo.es/");
    const { api, fetch, session } = await boot();
    const { api: client } = await import("@/lib/api");
    await client.categories.list();
    const [url, init] = fetch.mock.calls.at(-1)!;
    expect(url).toBe("https://api.ejemplo.es/v1/categories");
    expect(init.headers.Authorization).toBe(`Bearer ${session.accessToken}`);
    void api;
  });

  it("sin VITE_API_URL usa el mismo origen (ruta relativa)", async () => {
    const { fetch } = await boot();
    const { api: client } = await import("@/lib/api");
    await client.categories.list();
    expect(fetch.mock.calls.at(-1)![0]).toBe("/v1/categories");
  });

  it("convierte {code,message,field} en ApiError con el status", async () => {
    const { api } = await boot();
    const { api: client, ApiError } = await import("@/lib/api");
    const err = await client.orders
      .create({ id: "x", createdAt: new Date().toISOString(), paymentMethod: "efectivo", items: [] })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, code: "validation_error", field: "items" });
    expect(err.retryable).toBe(false);
    void api;
  });

  it("rechaza importes con más de 2 decimales con invalid_amount (código del servidor)", async () => {
    await boot();
    const { api: client } = await import("@/lib/api");
    const err = await client.orders
      .create({
        id: "x",
        createdAt: new Date().toISOString(),
        paymentMethod: "efectivo",
        items: [{ productId: null, name: "a", unitPrice: 1.005, quantity: 1, half: false }],
      })
      .catch((e) => e);
    expect(err.code).toBe("invalid_amount");
  });

  it("If-Match se envía como \"<revision>\" y 204 devuelve undefined", async () => {
    const { api } = await boot();
    const { api: client } = await import("@/lib/api");
    const created = await client.orders.create({
      id: "o1",
      createdAt: new Date().toISOString(),
      paymentMethod: "efectivo",
      items: [{ productId: null, name: "a", unitPrice: 1, quantity: 1, half: false }],
    });
    await client.orders.patch("o1", { status: "cancelado" }, created.revision);
    expect(api.log.find((l) => l.method === "PATCH")!.headers["if-match"]).toBe('"1"');
    expect(await client.orders.remove("o1")).toBeUndefined();
  });

  it("ante 401 refresca el token y repite la petición una vez", async () => {
    const { api } = await boot();
    const { api: client } = await import("@/lib/api");
    api.expireAccessTokens();
    expect(await client.categories.list()).toHaveLength(5);
    expect(api.countRequests("POST", "/v1/auth/refresh")).toBe(1);
    expect(api.countRequests("GET", "/v1/categories")).toBe(2); // 401 + reintento
  });

  it("refresca antes de que caduque (menos de 20 s de vida)", async () => {
    const { api } = await boot(new FakeApi(TEST_SEED));
    const { api: client } = await import("@/lib/api");
    const tokens = await import("@/lib/auth/tokens");
    const s = (await tokens.getSession())!;
    await tokens.saveSession({ ...s, expiresAt: Date.now() + 5_000 });
    await client.categories.list();
    expect(api.countRequests("POST", "/v1/auth/refresh")).toBe(1);
    expect(api.countRequests("GET", "/v1/categories")).toBe(1); // sin 401 previo
  });

  it("rotación: el refreshToken nuevo se guarda en IndexedDB y el viejo deja de valer", async () => {
    const { api, session } = await boot();
    const { api: client } = await import("@/lib/api");
    const tokens = await import("@/lib/auth/tokens");
    api.expireAccessTokens();
    await client.categories.list();
    const next = (await tokens.readStoredSession())!;
    expect(next.refreshToken).not.toBe(session.refreshToken);
    const reuse = await api.handle({ method: "POST", url: "/v1/auth/refresh", headers: {}, body: { refreshToken: session.refreshToken } });
    expect(reuse.status).toBe(401);
  });

  it("refresh rechazado: limpia la sesión y lanza 401", async () => {
    const { api } = await boot();
    const { api: client } = await import("@/lib/api");
    const tokens = await import("@/lib/auth/tokens");
    api.expireAccessTokens();
    api.revokeAllRefreshTokens();
    const err = await client.categories.list().catch((e) => e);
    expect(err).toMatchObject({ status: 401, code: "unauthorized" });
    expect(await tokens.getSession()).toBeNull();
  });

  it("sin sesión no sale ninguna petición autenticada", async () => {
    const { fetch } = installServer();
    const { api: client } = await import("@/lib/api");
    const err = await client.categories.list().catch((e) => e);
    expect(err).toMatchObject({ status: 401 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fallo de red = ApiError status 0 reintentable (y no cierra la sesión)", async () => {
    const { ctl } = await boot();
    const { api: client } = await import("@/lib/api");
    const tokens = await import("@/lib/auth/tokens");
    ctl.down = true;
    const err = await client.categories.list().catch((e) => e);
    expect(err).toMatchObject({ status: 0, code: "network_error", retryable: true });
    expect(await tokens.getSession()).not.toBeNull();
  });

  it("timeout de 10 s", async () => {
    const { ctl } = await boot();
    const { api: client } = await import("@/lib/api");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    ctl.hang = true;
    const p = client.categories.list().catch((e) => e);
    await vi.advanceTimersByTimeAsync(9_000);
    let settled = false;
    p.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1_100);
    expect(await p).toMatchObject({ status: 0, code: "timeout" });
  });

  it("429 y 5xx son reintentables; 4xx no", async () => {
    const { ApiError } = await import("@/lib/api");
    expect(new ApiError(429, "rate_limited", "").retryable).toBe(true);
    expect(new ApiError(503, "internal_error", "").retryable).toBe(true);
    expect(new ApiError(0, "network_error", "").retryable).toBe(true);
    expect(new ApiError(409, "conflict", "").retryable).toBe(false);
    expect(new ApiError(412, "revision_mismatch", "").retryable).toBe(false);
  });

  it("los errores se traducen por code en el diccionario del cliente", async () => {
    const { ApiError } = await import("@/lib/api");
    const { errorMessage } = await import("@/lib/errors");
    expect(errorMessage(new ApiError(409, "reorder_mismatch", "server msg"))).toMatch(/cambió en otro sitio/);
    // nunca se muestra el `message` del servidor (es español): un código desconocido da el texto genérico
    expect(errorMessage(new ApiError(400, "codigo_nuevo", "mensaje del servidor"))).toBe("No se pudo completar.");
    expect(errorMessage(new Error("x"))).toBe("No se pudo completar.");
  });

  it("pagina con cursor hasta traer todos los pedidos", async () => {
    const { api } = await boot();
    const { api: client } = await import("@/lib/api");
    for (let i = 0; i < 5; i++)
      await client.orders.create({
        id: `o${i}`,
        createdAt: new Date().toISOString(),
        paymentMethod: "efectivo",
        items: [{ productId: null, name: "a", unitPrice: 1, quantity: 1, half: false }],
      });
    const orig = api.handle.bind(api);
    api.handle = (req) => orig({ ...req, url: req.url.replace("limit=1000", "limit=2") });
    const day = api.orders[0].businessDay;
    expect(await client.orders.list({ date: day })).toHaveLength(5);
    expect(api.log.filter((l) => l.path === "/v1/orders" && l.method === "GET").length).toBe(3);
  });
});

describe("sesión", () => {
  it("signIn guarda los tokens en IndexedDB (almacén auth), nunca en Web Storage", async () => {
    const { api } = installServer();
    await signIn(api);
    const { dbGet } = await import("@/lib/db");
    expect(await dbGet("auth", "session")).toBeDefined();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
