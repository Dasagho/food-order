import { test, expect, login } from "./helpers";

test.describe("carga diferida de rutas", () => {
  test("/ventas y /menu se descargan bajo demanda, no en la carga inicial", async ({ page }) => {
    const scripts: string[] = [];
    page.on("request", (r) => {
      if (r.resourceType() === "script" && r.url().includes("/assets/")) scripts.push(r.url());
    });
    await login(page);
    const initial = scripts.length;

    await page.getByRole("link", { name: "Ventas" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Ventas" })).toBeVisible();
    expect(scripts.length).toBeGreaterThan(initial);

    const afterVentas = scripts.length;
    await page.getByRole("link", { name: "Menú" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Menú" })).toBeVisible();
    expect(scripts.length).toBeGreaterThan(afterVentas);
  });

  test("si falla la descarga de una ruta diferida aparece el ErrorBoundary con 'Recargar'", async ({ page }) => {
    await login(page);
    await page.route("**/assets/*-page-*.js", (route) => route.abort());
    await page.getByRole("link", { name: "Ventas" }).click();
    await expect(page.getByRole("alert")).toContainText("Algo ha fallado");
    await page.unroute("**/assets/*-page-*.js");
    await page.getByRole("button", { name: "Recargar" }).click();
    await page.goto("/ventas");
    await expect(page.getByRole("heading", { level: 1, name: "Ventas" })).toBeVisible();
  });
});

test.describe("sin conexión (service worker real)", () => {
  test.use({ serviceWorkers: "allow" });

  test("tras la primera carga, las rutas diferidas y el menú funcionan sin red", async ({ page, context }) => {
    await login(page);
    // esperar a que el service worker haya instalado y precacheado todo
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      await new Promise<void>((res) => {
        if (reg.active?.state === "activated") return res();
        reg.active?.addEventListener("statechange", () => reg.active?.state === "activated" && res());
      });
    });
    await expect
      .poll(() => page.evaluate(async () => (await caches.keys()).length), { timeout: 15000 })
      .toBeGreaterThan(0);

    // el service worker NO cachea la API (/v1/*): ninguna caché contiene esas URL
    const cachedApi = await page.evaluate(async () => {
      const out: string[] = [];
      for (const k of await caches.keys())
        for (const r of await (await caches.open(k)).keys())
          if (/\/v1\//.test(r.url)) out.push(r.url);
      return out;
    });
    expect(cachedApi).toEqual([]);

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Paella Valenciana" })).toBeVisible(); // sesión + catálogo en IndexedDB
    await page.getByRole("link", { name: "Ventas" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Ventas" })).toBeVisible();
    await page.getByRole("link", { name: "Menú" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Menú" })).toBeVisible();
    // la fuente local (woff2) también está precacheada: la Caja se ve igual sin red
    const fonts = await page.evaluate(async () => {
      const out: string[] = [];
      for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) if (/\.woff2(\?|$)/.test(r.url)) out.push(r.url);
      return out;
    });
    expect(fonts.length).toBeGreaterThanOrEqual(2);
    await context.setOffline(false);
  });
});
