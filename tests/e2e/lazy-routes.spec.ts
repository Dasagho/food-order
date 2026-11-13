import { test, expect } from "@playwright/test";

test.describe("carga diferida de rutas", () => {
  test("/pedidos y /admin se descargan bajo demanda, no en la carga inicial", async ({ page }) => {
    const scripts: string[] = [];
    page.on("request", (r) => {
      if (r.resourceType() === "script" && r.url().includes("/assets/")) scripts.push(r.url());
    });
    await page.goto("/");
    await expect(page.getByText("Paella Valenciana")).toBeVisible();
    const initial = scripts.length;

    await page.getByRole("button", { name: /Ver Pedidos/ }).click();
    await expect(page.getByRole("heading", { name: "Historial de Pedidos" })).toBeVisible();
    expect(scripts.length).toBeGreaterThan(initial);

    const afterPedidos = scripts.length;
    await page.getByRole("button", { name: "Volver al menú" }).click();
    await page.getByRole("button", { name: /Admin/ }).click();
    await expect(page.getByRole("heading", { name: "Panel de Administración" })).toBeVisible();
    expect(scripts.length).toBeGreaterThan(afterPedidos);
  });
});

test.describe("sin conexión (service worker real)", () => {
  test.use({ serviceWorkers: "allow" });

  test("tras la primera carga, las rutas diferidas funcionan sin red", async ({ page, context }) => {
    await page.goto("/");
    await expect(page.getByText("Paella Valenciana")).toBeVisible();
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

    await context.setOffline(true);
    await page.getByRole("button", { name: /Ver Pedidos/ }).click();
    await expect(page.getByRole("heading", { name: "Historial de Pedidos" })).toBeVisible();
    await page.getByRole("button", { name: "Volver al menú" }).click();
    await page.getByRole("button", { name: /Admin/ }).click();
    await expect(page.getByRole("heading", { name: "Panel de Administración" })).toBeVisible();
    await context.setOffline(false);
  });
});
