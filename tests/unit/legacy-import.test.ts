import { describe, it, expect, vi } from "vitest";
import { boot, installServer, signIn, seedLegacyIdb, seedLegacyLocalStorage, legacyOrder } from "./helpers";
import { FakeApi, TEST_SEED } from "../fake-api/fake-api";

const lsSnapshot = () => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]));

const legacyCategories = [
  { id: "arroces", name: "Arroces y Paellas", displayOrder: 1 },
  { id: "bebidas", name: "Bebidas", displayOrder: 2 },
];
const legacyProducts = [
  { id: "1", name: "Paella de la casa", price: 6, image: "/paella-valenciana.jpg", category: "arroces", portionType: "racion", halfPortionPrice: 4, displayOrder: 0 },
  { id: "9", name: "Agua", price: 1, image: "/agua.jpg", category: "bebidas", portionType: "unidades", displayOrder: 1 },
];

async function legacyModule() {
  const mod = await import("@/lib/legacy/legacy-import");
  const db = await import("@/lib/db");
  return { ...mod, ...db };
}
const counts = async () => {
  const { dbCount } = await import("@/lib/db");
  return { orders: await dbCount("orders"), products: await dbCount("products"), categories: await dbCount("categories") };
};

describe("importación de datos antiguos (SPEC §9.2)", () => {
  it("envía catálogo y pedidos de los almacenes legacy y, si el servidor responde bien, los vacía y marca meta", async () => {
    const { api } = await boot(new FakeApi({}));
    const { importLegacyData, getMeta, LEGACY_DONE_KEY } = await legacyModule();
    await seedLegacyIdb({
      orders: [legacyOrder(2, { date: new Date("2025-03-10T13:00:00Z") }), legacyOrder(1, { date: new Date("2025-03-10T12:00:00Z") })],
      products: legacyProducts,
      categories: legacyCategories,
    });

    const result = await importLegacyData();
    expect(result).toMatchObject({ status: "done", orders: 2, products: 2, categories: 2 });

    // el servidor tiene todo
    expect(api.products.map((p) => p.name)).toEqual(["Paella de la casa", "Agua"]);
    expect(api.categories).toHaveLength(2);
    expect(api.orders).toHaveLength(2);
    // los números se recalculan por día en orden de fecha y el antiguo se conserva
    expect(api.orders.map((o) => [o.id, o.number, o.legacyNumber]).sort()).toEqual([
      ["legacy-1", 1, 1],
      ["legacy-2", 2, 2],
    ]);
    // el catálogo va ANTES que los pedidos
    const order = api.log.filter((l) => l.path.startsWith("/v1/import")).map((l) => l.path);
    expect(order).toEqual(["/v1/import/catalog", "/v1/import/orders"]);
    // formato legacy del cliente antiguo
    const sent = api.log.find((l) => l.path === "/v1/import/orders")!.body.orders[0];
    expect(sent).toMatchObject({ id: "legacy-1", orderNumber: 1, status: "completado", paymentMethod: "efectivo" });
    expect(sent.date).toBe("2025-03-10T12:00:00.000Z");
    expect(sent.items[0]).toMatchObject({ id: "1", name: "Paella Valenciana", price: 4.5, quantity: 2, isHalfPortion: false });
    expect(api.log.find((l) => l.path === "/v1/import/catalog")!.body.products[0]).toMatchObject({
      id: "1", category: "arroces", image: "/paella-valenciana.jpg", displayOrder: 0,
    });

    // IndexedDB legacy vacío y marca puesta
    expect(await counts()).toEqual({ orders: 0, products: 0, categories: 0 });
    expect(await getMeta(LEGACY_DONE_KEY)).toMatchObject({ orders: 2, products: 2 });
  });

  it("el catálogo rechazado por el servidor (200 con errors) NO se borra de IndexedDB; imagen vacía -> placeholder", async () => {
    const { api } = await boot(new FakeApi({}));
    const { importLegacyData, getMeta, LEGACY_DONE_KEY } = await legacyModule();
    await seedLegacyIdb({
      orders: [],
      products: [
        ...legacyProducts,
        { id: "x1", name: "Sin foto", price: 3, image: "", category: "bebidas", portionType: "unidades", displayOrder: 2 },
        { id: "x2", name: "Categoría rota", price: 3, image: "/x.jpg", category: "no-existe", portionType: "unidades", displayOrder: 3 },
      ],
      categories: legacyCategories,
    });
    const result = await importLegacyData();
    expect(result).toEqual({ status: "partial", remaining: 1 });
    // la imagen vacía se envía como /placeholder.svg y el producto entra
    expect(api.products.find((p) => p.id === "x1")!.imageUrl).toBe("/placeholder.svg");
    expect(api.products.some((p) => p.id === "x2")).toBe(false);
    // solo se conserva en local lo no confirmado
    const { dbCount } = await import("@/lib/db");
    expect(await dbCount("products")).toBe(1);
    expect(await dbCount("categories")).toBe(0);
    expect(await getMeta(LEGACY_DONE_KEY)).toBeUndefined();
  });

  it("el catálogo de la tablet SIEMPRE se envía y manda: aunque el servidor ya tenga productos, sobrescribe por id, crea lo que falta y conserva lo que solo está en el servidor", async () => {
    // el servidor ya tiene el menú de ejemplo (ids 1..4); la tablet trae el suyo: «1» con otro nombre/precio, más el «9»
    const { api } = await boot(new FakeApi(TEST_SEED));
    const { importLegacyData, getMeta, LEGACY_DONE_KEY } = await legacyModule();
    await seedLegacyIdb({
      orders: [legacyOrder(1)],
      products: [
        { id: "1", name: "Paella de la casa", price: 6, image: "/paella-valenciana.jpg", category: "arroces", portionType: "racion", halfPortionPrice: 4, displayOrder: 0 },
        { id: "9", name: "Agua", price: 1, image: "/agua.jpg", category: "bebidas", portionType: "unidades", displayOrder: 1 },
      ],
      categories: [
        { id: "arroces", name: "Arroces y Paellas", displayOrder: 1 },
        { id: "bebidas", name: "Bebidas", displayOrder: 2 },
      ],
    });
    expect(await importLegacyData()).toMatchObject({ status: "done", products: 2 });
    // no se consulta GET /products para decidir nada: el catálogo se envía siempre
    expect(api.log.some((l) => l.method === "GET" && l.path === "/v1/products")).toBe(false);
    expect(api.log.some((l) => l.path === "/v1/import/catalog")).toBe(true);
    // sobrescribe por id
    expect(api.products.find((p) => p.id === "1")).toMatchObject({ name: "Paella de la casa", price: 6, halfPortionPrice: 4 });
    // crea lo que faltaba
    expect(api.products.find((p) => p.id === "9")).toMatchObject({ name: "Agua", price: 1 });
    // conserva lo que solo existía en el servidor
    expect(api.products.map((p) => p.id).sort()).toEqual(["1", "2", "3", "4", "9"]);
    expect(api.products.find((p) => p.id === "2")!.name).toBe("Arroz de marisco");
    // y los almacenes legacy quedan vacíos con la marca puesta
    expect(await counts()).toEqual({ orders: 0, products: 0, categories: 0 });
    expect(await getMeta(LEGACY_DONE_KEY)).toBeDefined();
  });

  it("los importes con más de 2 decimales se redondean a céntimos antes de enviarlos (invalid_amount)", async () => {
    const { api } = await boot(new FakeApi({}));
    const { importLegacyData } = await legacyModule();
    await seedLegacyIdb({ orders: [legacyOrder(1, { items: [{ id: "1", name: "Paella", price: 4.499999999, quantity: 1, isHalfPortion: false }] })], products: [], categories: [] });
    await importLegacyData();
    expect(api.log.find((l) => l.path === "/v1/import/orders")!.body.orders[0].items[0].price).toBe(4.5);
  });

  it("lee localStorage (solo lectura) con el mecanismo de migración y NO lo modifica", async () => {
    const { api } = await boot(new FakeApi({}));
    seedLegacyLocalStorage({ orders: [legacyOrder(1)], products: legacyProducts, categories: legacyCategories });
    const before = lsSnapshot();
    const { importLegacyData } = await legacyModule();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const removeItem = vi.spyOn(Storage.prototype, "removeItem");
    const clear = vi.spyOn(Storage.prototype, "clear");

    expect(await importLegacyData()).toMatchObject({ status: "done", orders: 1 });
    expect(api.orders).toHaveLength(1);
    expect(api.products).toHaveLength(2);
    expect(lsSnapshot()).toEqual(before);
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(await counts()).toEqual({ orders: 0, products: 0, categories: 0 });
  });

  it("actualiza una base de datos REAL de la versión 1 (la de la PR) conservando sus datos", async () => {
    // Base de datos exactamente como la dejaba la PR: versión 1, almacenes y claves _pos
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open("food-order", 1);
      open.onupgradeneeded = () => {
        const db = open.result;
        const orders = db.createObjectStore("orders", { keyPath: "id" });
        orders.createIndex("seq", "_pos");
        orders.createIndex("orderNumber", "orderNumber");
        db.createObjectStore("products", { keyPath: "id" }).createIndex("pos", "_pos");
        db.createObjectStore("categories", { keyPath: "id" }).createIndex("pos", "_pos");
        db.createObjectStore("meta", { keyPath: "key" });
        orders.put({ ...legacyOrder(5), _pos: 1 });
      };
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(["products", "meta"], "readwrite");
        tx.objectStore("products").put({ ...legacyProducts[0], _pos: 1 });
        tx.objectStore("meta").put({ key: "migrated_from_localstorage_v1", value: { at: "x" } });
        tx.objectStore("meta").put({ key: "seeded_products", value: true });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
      };
      open.onerror = () => reject(open.error);
    });
    const { api } = await boot(new FakeApi(TEST_SEED)); // el servidor ya tiene las categorías (como tras `npm run seed`)
    const { importLegacyData, getMeta, dbAll } = await legacyModule();
    expect(await importLegacyData()).toMatchObject({ status: "done", orders: 1, products: 1 });
    expect(api.orders[0]).toMatchObject({ id: "legacy-5", legacyNumber: 5 });
    expect(api.products[0].name).toBe("Paella de la casa");
    expect(await dbAll("orders")).toEqual([]);
    // queda el meta mínimo: la marca de migración y la de importación hecha
    expect(await getMeta("seeded_products")).toBeUndefined();
    expect(await getMeta("migrated_from_localstorage_v1")).toBeDefined();
  });

  it("si el servidor falla se conserva TODO y se reintenta después sin duplicar", async () => {
    const { api, ctl } = await boot(new FakeApi({}));
    const { importLegacyData, getMeta, LEGACY_DONE_KEY } = await legacyModule();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await seedLegacyIdb({ orders: [legacyOrder(1), legacyOrder(2)], products: legacyProducts, categories: legacyCategories });

    ctl.down = true;
    expect((await importLegacyData()).status).toBe("failed");
    expect(await counts()).toEqual({ orders: 2, products: 2, categories: 2 });
    expect(await getMeta(LEGACY_DONE_KEY)).toBeUndefined();

    api.intercept = (req) => (req.url === "/v1/import/orders" ? { status: 500, body: { code: "internal_error", message: "x" } } : undefined);
    ctl.down = false;
    expect((await importLegacyData()).status).toBe("failed");
    // el catálogo sí se confirmó y se vació; los pedidos se conservan
    expect(await counts()).toEqual({ orders: 2, products: 0, categories: 0 });

    api.intercept = null;
    expect(await importLegacyData()).toMatchObject({ status: "done" });
    expect(api.orders).toHaveLength(2);
    expect(await counts()).toEqual({ orders: 0, products: 0, categories: 0 });
  });

  it("es idempotente: tras terminar no vuelve a enviar nada", async () => {
    const { api } = await boot(new FakeApi({}));
    const { importLegacyData } = await legacyModule();
    await seedLegacyIdb({ orders: [legacyOrder(1)] });
    await importLegacyData();
    const calls = api.log.length;
    expect(await importLegacyData()).toEqual({ status: "skipped" });
    expect(api.log.length).toBe(calls);
  });

  it("repetirla con los mismos datos no duplica pedidos (el servidor salta los ids existentes)", async () => {
    const { api } = await boot(new FakeApi({}));
    const { importLegacyData, dbDelete } = await legacyModule();
    await seedLegacyIdb({ orders: [legacyOrder(1), legacyOrder(2)] });
    await importLegacyData();
    await dbDelete("meta", "legacy_import_done");
    await seedLegacyIdb({ orders: [legacyOrder(1), legacyOrder(2)] }); // p. ej. el almacén reapareció
    const r = await importLegacyData();
    expect(r).toMatchObject({ status: "done", skipped: 2, orders: 0 });
    expect(api.orders).toHaveLength(2);
  });

  it("si el servidor rechaza algún pedido, solo se borran los confirmados y no se marca como terminada", async () => {
    const { api } = await boot(new FakeApi({}));
    const { importLegacyData, getMeta, LEGACY_DONE_KEY, dbAll } = await legacyModule();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await seedLegacyIdb({ orders: [legacyOrder(1), legacyOrder(2, { date: "no es una fecha" }), legacyOrder(3)] });
    const r = await importLegacyData();
    expect(r).toEqual({ status: "partial", remaining: 1 });
    expect(api.orders.map((o) => o.id).sort()).toEqual(["legacy-1", "legacy-3"]);
    expect((await dbAll<any>("orders")).map((o) => o.id)).toEqual(["legacy-2"]);
    expect(await getMeta(LEGACY_DONE_KEY)).toBeUndefined();
  });

  it("envía los pedidos en tandas de 200 y por orden de fecha", async () => {
    const { api } = await boot(new FakeApi({}));
    const { importLegacyData } = await legacyModule();
    const many = Array.from({ length: 450 }, (_, i) =>
      legacyOrder(i + 1, { date: new Date(Date.UTC(2025, 0, 1, 10, 0, 0) + i * 60_000) }),
    );
    await seedLegacyIdb({ orders: [...many].reverse() }); // en el almacén, el más reciente primero
    expect(await importLegacyData()).toMatchObject({ status: "done", orders: 450 });
    const batches = api.log.filter((l) => l.path === "/v1/import/orders");
    expect(batches.map((b) => b.body.orders.length)).toEqual([200, 200, 50]);
    expect(batches[0].body.orders[0].id).toBe("legacy-1");
    expect(api.orders.map((o) => o.number)).toEqual(Array.from({ length: 450 }, (_, i) => i + 1));
  });

  it("sin datos antiguos (instalación nueva) no llama a la API de importación y deja la marca", async () => {
    const { api } = await boot(new FakeApi({}));
    const { importLegacyData, getMeta, LEGACY_DONE_KEY } = await legacyModule();
    expect(await importLegacyData()).toEqual({ status: "nothing" });
    expect(api.log.filter((l) => l.path.startsWith("/v1/import"))).toEqual([]);
    expect(await getMeta(LEGACY_DONE_KEY)).toBeDefined();
  });

  it("sin sesión no importa nada y lo conserva todo", async () => {
    const { api } = installServer(new FakeApi({}));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { importLegacyData } = await legacyModule();
    await seedLegacyIdb({ orders: [legacyOrder(1)] });
    expect((await importLegacyData()).status).toBe("failed");
    expect(api.orders).toEqual([]);
    expect(await counts()).toEqual({ orders: 1, products: 0, categories: 0 });
    await signIn(api);
    expect((await importLegacyData()).status).toBe("done");
  });

  it("con el token caducado refresca de forma transparente", async () => {
    const { api } = await boot(new FakeApi({}));
    const { importLegacyData } = await legacyModule();
    await seedLegacyIdb({ orders: [legacyOrder(1)] });
    api.expireAccessTokens();
    expect((await importLegacyData()).status).toBe("done");
    expect(api.orders).toHaveLength(1);
  });

  it("startSync (arranque autenticado) lanza la importación y refresca el catálogo", async () => {
    const { api } = await boot(new FakeApi(TEST_SEED));
    await seedLegacyIdb({ orders: [legacyOrder(1)] });
    const { startSync } = await import("@/lib/sync/bootstrap");
    const results: any[] = [];
    const stop = startSync((r) => results.push(r));
    await vi.waitFor(() => expect(results.map((r) => r.status)).toEqual(["done"]));
    expect(api.orders).toHaveLength(1);
    stop();
  });
});
