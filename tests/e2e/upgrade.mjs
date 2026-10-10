// Test de actualización: versión ANTIGUA (commit baseline) -> versión NUEVA (working tree),
// con el MISMO perfil de Chrome y el MISMO origen. Simula a la usuaria real que recibe la actualización.
//
// Uso: node tests/e2e/upgrade.mjs   (BASELINE=<commit> para cambiar el commit base)
import { chromium } from "@playwright/test";
import { execSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const ROOT = path.resolve(import.meta.dirname, "../..");
const BASELINE = process.env.BASELINE ?? "b2250a1";
const PORT = 4180;
const ORIGIN = `http://localhost:${PORT}`;
const work = mkdtempSync(path.join(tmpdir(), "upgrade-"));
const oldTree = path.join(work, "old");
const oldDist = path.join(work, "dist-old");
const newDist = path.join(work, "dist-new");
const profile = path.join(work, "profile");

const sh = (cmd, cwd = ROOT) => execSync(cmd, { cwd, stdio: "pipe" }).toString();
let server;
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

try {
  console.log(`• construyendo versión ANTIGUA (${BASELINE})…`);
  sh(`git worktree add --detach ${oldTree} ${BASELINE}`);
  symlinkSync(path.join(ROOT, "node_modules"), path.join(oldTree, "node_modules"));
  sh(`npx vite build --outDir ${oldDist} --emptyOutDir`, oldTree);
  console.log("• construyendo versión NUEVA (working tree)…");
  sh(`npx vite build --outDir ${newDist} --emptyOutDir`);

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

  // ───────── FASE 2: llega la actualización; la usuaria solo abre la app ─────────
  console.log("• fase 2: abre la versión NUEVA con el mismo perfil (sin hacer nada)");
  await serve(newDist);
  ctx = await launch();
  page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const dialogs = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); d.dismiss(); });

  await page.goto(ORIGIN + "/");
  await page.getByText("Paella de la casa").waitFor({ timeout: 15000 }); // menú editado intacto
  assert.equal(await page.getByText("Paella Valenciana").count(), 0, "no debe resembrar el menú por defecto");

  await page.goto(ORIGIN + "/pedidos");
  await page.getByText("Pedido #1", { exact: true }).waitFor();
  await page.getByText("Pedido #2", { exact: true }).waitFor();
  await page.locator("span", { hasText: /^Cancelado$/ }).waitFor();
  assert.ok(await page.getByText(/2\s+pedidos/).isVisible(), "pedidos de hoy: 2");

  // Operar sobre los datos migrados y que la numeración continúe tras el máximo histórico (2999)
  await createOrder(page, { dish: "Arroz de marisco" });
  await page.goto(ORIGIN + "/pedidos");
  await page.getByText("Pedido #3000", { exact: true }).waitFor();

  // Persistencia tras nueva recarga completa
  await page.reload();
  await page.getByText("Pedido #3000", { exact: true }).waitFor();
  await page.getByText("Pedido #1", { exact: true }).waitFor();

  // Comprobación directa: los datos viven realmente en IndexedDB y localStorage sigue como respaldo
  const idb = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("food-order");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(["orders", "meta"]);
          const count = tx.objectStore("orders").count();
          const flag = tx.objectStore("meta").get("migrated_from_localstorage_v1");
          tx.oncomplete = () => resolve({ orders: count.result, migrated: flag.result?.value });
        };
      }),
  );
  assert.equal(idb.orders, before.orders.length + 1, "IndexedDB contiene todo el histórico + el pedido nuevo");
  assert.equal(idb.migrated.orders, before.orders.length, "el flag registra los pedidos migrados");
  const lsAfter = await page.evaluate(() => JSON.parse(localStorage.getItem("confirmed_orders")).length);
  assert.equal(lsAfter, before.orders.length, "localStorage queda intacto como respaldo");
  console.log(`  (IndexedDB: ${idb.orders} pedidos; migrados: ${idb.migrated.orders})`);

  // La app nueva ya no depende del límite de localStorage: seguimos escribiendo con >5MB históricos
  assert.deepEqual(errors, [], "sin errores de JS: " + errors.join("; "));
  assert.deepEqual(dialogs, [], "sin alert()/confirm() inesperados: " + dialogs.join("; "));
  await ctx.close();
  console.log("✔ actualización transparente: todos los datos intactos y la app operativa");
} finally {
  stop();
  try { sh(`git worktree remove --force ${oldTree}`); } catch {}
  rmSync(work, { recursive: true, force: true });
}
