// Test de actualización: versión ANTIGUA (commit baseline, todo en localStorage) -> versión NUEVA
// (working tree, servidor como fuente de verdad), con el MISMO perfil de Chrome y el MISMO origen.
// Simula a la usuaria real que recibe la actualización: al iniciar sesión, sus datos antiguos se
// IMPORTAN al servidor (aquí el backend FALSO de tests/fake-api) y se vacían los almacenes locales.
//
// Uso: node tests/e2e/upgrade.mjs   (BASELINE=<commit> para cambiar el commit base)
//      E2E_BACKEND=real node tests/e2e/upgrade.mjs   -> contra food-order-api REAL (ya compilado) en vez del fake;
//      además comprueba renumeración por día, legacyNumber y que repetir la importación no duplica.
import { chromium } from "@playwright/test";
import { execSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const REAL = process.env.E2E_BACKEND === "real";
const ROOT = path.resolve(import.meta.dirname, "../..");
const BASELINE = process.env.BASELINE ?? "b2250a1";
const PORT = 4180;
const API_PORT = 4181;
const ORIGIN = `http://localhost:${PORT}`;
const API = `http://localhost:${API_PORT}`;
const work = mkdtempSync(path.join(tmpdir(), "upgrade-"));
const oldTree = path.join(work, "old");
const oldDist = path.join(work, "dist-old");
const newDist = path.join(work, "dist-new");
const profile = path.join(work, "profile");

const sh = (cmd, cwd = ROOT) => execSync(cmd, { cwd, stdio: "pipe" }).toString();
let server;
let fakeApi;
const startFakeApi = async () => {
  fakeApi = spawn("node", [REAL ? "tests/real-api/control.mjs" : "tests/fake-api/server.ts"], {
    cwd: ROOT, stdio: "inherit", detached: true,
    env: { ...process.env, FAKE_API_PORT: String(API_PORT), CONTROL_PORT: String(API_PORT), FRONTEND_ORIGINS: ORIGIN },
  });
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(API + "/health")).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("el backend falso no arrancó");
};
const stopFakeApi = () => { if (fakeApi) { try { process.kill(-fakeApi.pid); } catch {} fakeApi = null; } };
const serve = async (dist) => {
  server = spawn("npx", ["vite", "preview", "--outDir", dist, "--port", String(PORT), "--strictPort"], {
    cwd: ROOT, stdio: "ignore", detached: true,
  });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(ORIGIN)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("preview no arrancó");
};
const stop = () => { if (server) { try { process.kill(-server.pid); } catch {} server = null; } };
const launch = () =>
  chromium.launchPersistentContext(profile, {
    executablePath: "/usr/bin/google-chrome", args: ["--no-sandbox"],
    viewport: { width: 1280, height: 900 }, locale: "es-ES", timezoneId: "Europe/Madrid",
    serviceWorkers: "block",
  });

async function createOrder(page, { dish = "Paella Valenciana", payment = "Efectivo" } = {}) {
  await page.goto(ORIGIN + "/");
  const card = page.locator("div.overflow-hidden", { hasText: dish }).first();
  await card.getByRole("button", { name: /Ración Completa/ }).click();
  await page.getByRole("button", { name: /Ver pedido/ }).click();
  await page.getByRole("button", { name: payment, exact: true }).click();
  await page.getByRole("button", { name: /Confirmar Pedido/ }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
}

// Versión NUEVA (rediseño): una venta de un plato desde la Caja
async function createOrderNew(page, { dish = "Paella Valenciana" } = {}) {
  await page.goto(ORIGIN + "/");
  await page.getByRole("heading", { name: dish, exact: true }).locator("xpath=ancestor::li[1]")
    .getByRole("button", { name: /Cobrar (Completa|Ración|Añadir)/ }).click();
  await page.locator("#ticket").getByRole("button", { name: /^Cobrar/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirmar" }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await page.getByRole("status").filter({ hasText: /Venta .* guardada/ }).waitFor();
}
const saleRow = (page, n) => page.locator(".srow").filter({ has: page.locator(".s-num", { hasText: new RegExp(`^nº\\s*${n}$`) }) });

try {
  console.log(`• construyendo versión ANTIGUA (${BASELINE})…`);
  sh(`git worktree add --detach ${oldTree} ${BASELINE}`);
  // La versión antigua usa Tailwind/Radix/sonner…, que la nueva ya no tiene: instala SUS dependencias (caché local de npm)
  sh("npm ci --prefer-offline --no-audit --no-fund", oldTree);
  // La versión nueva ya no depende de `pocketbase` (se desinstaló). La antigua solo lo usa para
  // sincronizar con la nube, y la usuaria de este test nunca inicia sesión: basta un sustituto inerte.
  writeFileSync(
    path.join(oldTree, "src/lib/pocketbase.ts"),
    `export const getPocketBase = () => ({});
export const isOnline = () => navigator.onLine;
export const loginWithOAuth = async () => { throw new Error("sin PocketBase"); };
export const logout = () => {};
export const isAuthenticated = () => false;
export const getCurrentUser = () => null;
export const syncOrderToPocketBase = async () => false;
export const getOrdersFromPocketBase = async () => [];
export const syncAllOrdersToPocketBase = async () => {};
export const onAuthChange = () => {};
`,
  );
  sh(`npx vite build --outDir ${oldDist} --emptyOutDir`, oldTree);
  console.log("• construyendo versión NUEVA (working tree)…");
  execSync(`npx vite build --outDir ${newDist} --emptyOutDir`, {
    cwd: ROOT, stdio: "pipe", env: { ...process.env, VITE_API_URL: API, VITE_DEV_LOGIN: "1" },
  });

  // ───────── FASE 1: usuaria con la versión antigua ─────────
  console.log("• fase 1: usando la versión antigua");
  await serve(oldDist);
  let ctx = await launch();
  let page = await ctx.newPage();
  await createOrder(page, { payment: "Bizum" });
  await createOrder(page, { dish: "Arroz de marisco", payment: "Tarjeta" });
  // pedido cancelado + menú editado + datos pesados (cerca del límite de 5 MB)
  await page.goto(ORIGIN + "/pedidos");
  await page.getByRole("button", { name: /Editar Pedido/ }).first().click();
  await page.getByRole("button", { name: "Cancelado" }).click();
  await page.goto(ORIGIN + "/admin");
  const card = page.locator("div.rounded-xl", { hasText: "Paella Valenciana" }).first();
  await card.getByRole("button", { name: /Editar/ }).click();
  await page.locator("#name").fill("Paella de la casa");
  await page.getByRole("button", { name: /Actualizar Producto/ }).click();
  await page.evaluate(() => {
    const orders = JSON.parse(localStorage.getItem("confirmed_orders"));
    const base = orders[0];
    const old = [];
    for (let i = 0; i < 2000; i++) {
      old.push({ ...base, id: `hist-${i}`, orderNumber: 1000 + i, date: "2025-01-15T12:00:00.000Z",
        items: base.items.map((it) => ({ ...it, name: it.name + " ".repeat(2000) })) });
    }
    localStorage.setItem("confirmed_orders", JSON.stringify([...orders, ...old]));
  });
  const before = await page.evaluate(() => ({
    orders: JSON.parse(localStorage.getItem("confirmed_orders")),
    products: localStorage.getItem("menu_products"),
    categories: localStorage.getItem("menu_categories"),
    bytes: localStorage.getItem("confirmed_orders").length,
  }));
  console.log(`  (localStorage antes: ${(before.bytes / 1e6).toFixed(2)} MB, ${before.orders.length} pedidos)`);
  await ctx.close();
  stop();

  // ───────── FASE 2: llega la actualización; la usuaria abre la app e inicia sesión ─────────
  console.log("• fase 2: abre la versión NUEVA con el mismo perfil e inicia sesión");
  await startFakeApi();
  await serve(newDist);
  ctx = await launch();
  page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const dialogs = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); d.dismiss(); });

  await page.goto(ORIGIN + "/");
  await page.getByRole("button", { name: "Entrar sin Microsoft (desarrollo)" }).click();
  await page.getByText(/Datos antiguos importados al servidor/).waitFor({ timeout: 60000 });
  await page.getByRole("heading", { name: "Paella de la casa" }).waitFor({ timeout: 15000 }); // menú editado intacto
  assert.equal(await page.getByRole("heading", { name: "Paella Valenciana", exact: true }).count(), 0, "el catálogo de la tablet manda: sobrescribe por id lo del servidor");

  const serverOrders = await (await fetch(API + "/__orders")).json();
  assert.equal(serverOrders.length, before.orders.length, "el servidor tiene TODOS los pedidos antiguos");
  assert.equal(new Set(serverOrders.map((o) => o.id)).size, serverOrders.length, "sin duplicados");
  if (REAL) {
    // Renumeración por día (SPEC §6.5): números 1..n por día de negocio y el antiguo en legacyNumber
    const byDay = new Map();
    for (const o of serverOrders) byDay.set(o.businessDay, [...(byDay.get(o.businessDay) ?? []), o]);
    for (const [day, list] of byDay) {
      const nums = list.map((o) => o.number).sort((a, b) => a - b);
      assert.deepEqual(nums, nums.map((_, i) => i + 1), `numeración 1..n sin huecos el ${day}`);
      assert.ok(list.every((o) => o.legacyNumber !== null), `legacyNumber informado el ${day}`);
    }
    const hist = byDay.get("2025-01-15");
    assert.equal(hist.length, 2000, "2000 pedidos históricos en su día de negocio");
    assert.deepEqual(
      hist.sort((a, b) => a.number - b.number).slice(0, 3).map((o) => [o.number, o.legacyNumber]),
      [[1, 1000], [2, 1001], [3, 1002]], "renumerados desde 1 conservando el número antiguo");
    assert.deepEqual(
      (byDay.get(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date())) ?? [])
        .sort((a, b) => a.number - b.number).map((o) => [o.number, o.legacyNumber]),
      [[1, 1], [2, 2]], "los 2 pedidos de hoy: #1 y #2 con su legacyNumber");
    console.log(`  (real: ${serverOrders.length} pedidos en ${byDay.size} días; numeración por día OK)`);
    // paginación: el día histórico tiene 2000 pedidos y el servidor pagina a 1000
    const tok = (await (await fetch(API + "/v1/auth/dev-login", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json()).accessToken;
    const pg = async (cursor) => (await fetch(`${API}/v1/orders?date=2025-01-15&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { headers: { authorization: `Bearer ${tok}` } })).json();
    const p1 = await pg(); const p2 = await pg(p1.nextCursor); const p3 = p2.nextCursor ? await pg(p2.nextCursor) : { items: [], nextCursor: null };
    assert.deepEqual([p1.items.length, p2.items.length, p3.items.length, p3.nextCursor], [1000, 1000, 0, null], "paginación por cursor");
    assert.equal(new Set([...p1.items, ...p2.items].map((o) => o.id)).size, 2000, "sin solapes entre páginas");
    // El selector de fecha + listado de la app con 2000 pedidos (dos páginas)
    await page.goto(ORIGIN + "/ventas");
    await saleRow(page, 1).waitFor();
  }

  await page.goto(ORIGIN + "/ventas");
  await saleRow(page, 1).waitFor();
  await saleRow(page, 2).waitFor();
  await page.locator(".chip.cancelado").waitFor();
  assert.equal(await page.locator(".srow").count(), 2, "pedidos de hoy: 2");

  // Operar con el servidor: la numeración (por día) continúa
  await createOrderNew(page, { dish: "Arroz de marisco" });
  await page.goto(ORIGIN + "/ventas");
  await saleRow(page, 3).waitFor();

  // Persistencia tras nueva recarga completa
  await page.reload();
  await saleRow(page, 3).waitFor();

  if (REAL) {
    // ───────── Repetir la importación NO duplica ─────────
    // localStorage sigue intacto: se borran las marcas y se recarga; la app lo reenvía TODO al servidor.
    await page.evaluate(() => new Promise((resolve, reject) => {
      const open = indexedDB.open("food-order");
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("meta", "readwrite");
        for (const k of ["legacy_import_done", "migrated_from_localstorage_v1", "seeded_products", "seeded_categories"]) tx.objectStore("meta").delete(k);
        tx.oncomplete = () => resolve();
      };
    }));
    const countBefore = (await (await fetch(API + "/__orders")).json()).length;
    await page.reload();
    await page.getByText(/Datos antiguos importados al servidor: 0 pedidos/).waitFor({ timeout: 60000 });
    const again = await (await fetch(API + "/__orders")).json();
    assert.equal(again.length, countBefore, "reimportar no crea duplicados");
    const meta = await page.evaluate(() => new Promise((resolve) => {
      const open = indexedDB.open("food-order");
      open.onsuccess = () => { const g = open.result.transaction("meta").objectStore("meta").get("legacy_import_done"); g.onsuccess = () => resolve(g.result?.value); };
    }));
    assert.deepEqual([meta.orders, meta.skipped], [0, before.orders.length], "la 2ª importación: 0 creados, todos saltados");
    console.log(`  (reimportación: 0 creados, ${meta.skipped} saltados, servidor sigue con ${again.length})`);
  }

  // Comprobación directa: IndexedDB legacy vaciado, marca puesta, y localStorage intacto (nunca se escribe)
  const idb = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("food-order");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(["orders", "products", "categories", "meta", "outbox", "auth"]);
          const c = (s) => tx.objectStore(s).count();
          const orders = c("orders"), products = c("products"), categories = c("categories"), outbox = c("outbox");
          const done = tx.objectStore("meta").get("legacy_import_done");
          const session = tx.objectStore("auth").get("session");
          tx.oncomplete = () =>
            resolve({ orders: orders.result, products: products.result, categories: categories.result,
              outbox: outbox.result, done: done.result?.value, session: !!session.result });
        };
      }),
  );
  assert.deepEqual([idb.orders, idb.products, idb.categories, idb.outbox], [0, 0, 0, 0], "almacenes legacy y cola vacíos");
  assert.equal(REAL ? idb.done.skipped : idb.done.orders, before.orders.length, "la marca registra los pedidos importados");
  assert.ok(idb.session, "la sesión vive en IndexedDB");
  const lsAfter = await page.evaluate(() => JSON.parse(localStorage.getItem("confirmed_orders")).length);
  assert.equal(lsAfter, before.orders.length, "localStorage queda intacto como respaldo");
  console.log(`  (servidor: ${serverOrders.length} pedidos importados; IndexedDB legacy vacío)`);

  assert.deepEqual(errors, [], "sin errores de JS: " + errors.join("; "));
  assert.deepEqual(dialogs, [], "sin alert()/confirm() inesperados: " + dialogs.join("; "));
  await ctx.close();
  console.log("✔ actualización transparente: datos antiguos importados al servidor y app operativa");
} finally {
  stop();
  stopFakeApi();
  try { sh(`git worktree remove --force ${oldTree}`); } catch {}
  rmSync(work, { recursive: true, force: true });
}
