import type { Page } from "@playwright/test";
import { test, expect, login, server, tile, createOrderViaUI, apiCall, apiUpload, bigPng, imgLoaded, PNG_1PX, APP, API } from "./helpers";

// Imágenes de productos (SPEC §6.6): POST /v1/uploads -> {url:"/media/<uuid>.webp", key}; el navegador las pide a
// /media/<clave> en el MISMO origen que la app (en producción nginx las enruta al bucket; aquí `vite preview` las
// reenvía al fake / backend real). Nunca al origen de la API (VITE_API_URL).

const dialog = (page: Page) => page.getByRole("dialog").last();
const MEDIA_URL = /^\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;

async function openNewDish(page: Page, name: string) {
  await page.getByRole("link", { name: "Menú" }).click();
  await page.getByRole("button", { name: "+ Plato nuevo" }).click();
  await dialog(page).getByLabel(/Nombre \(español\)/).fill(name);
  await dialog(page).getByLabel(/Precio ración/).fill("5");
  await dialog(page).getByLabel("¿Cómo se vende?").selectOption("unidades");
}

test.describe("Imágenes de productos en /media", () => {
  test("una foto subida se ve en la vista previa, el Menú, la tarjeta de la Caja y el detalle de un pedido, siempre desde el origen de la app", async ({ page }) => {
    const mediaRequests: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/media/")) mediaRequests.push(r.url());
    });
    await login(page);
    await openNewDish(page, "Plato con foto");
    await dialog(page).getByLabel("Elegir foto").setInputFiles({ name: "foto.png", mimeType: "image/png", buffer: PNG_1PX });
    await expect(dialog(page).getByText("Foto lista.")).toBeVisible();

    // la vista previa usa la ruta relativa devuelta por la API
    const preview = dialog(page).locator("img.preview");
    const url = (await preview.getAttribute("src"))!;
    expect(url).toMatch(MEDIA_URL);
    await expect.poll(() => imgLoaded(preview)).toBe(true);

    await dialog(page).getByRole("button", { name: "Crear" }).click();
    const row = page.locator(".arow", { hasText: "Plato con foto" }).first();
    await expect(row).toBeVisible();
    await row.scrollIntoViewIfNeeded();
    await expect.poll(() => imgLoaded(row.locator("img").first())).toBe(true); // Menú

    // el producto guarda la `url` relativa (no una absoluta ni la clave suelta)
    const saved = (await server.catalog()).products.find((p: any) => p.name === "Plato con foto");
    expect(saved.imageUrl).toBe(url);

    // tarjeta de la Caja: lazy + async y dimensiones fijas (sin saltos de layout)
    await page.getByRole("link", { name: "Caja", exact: true }).click();
    const card = tile(page, "Plato con foto").locator("img");
    await card.scrollIntoViewIfNeeded();
    await expect.poll(() => imgLoaded(card)).toBe(true);
    await expect(card).toHaveAttribute("src", url);
    await expect(card).toHaveAttribute("loading", "lazy");
    await expect(card).toHaveAttribute("decoding", "async");
    await expect(card).toHaveAttribute("width", "400");
    await expect(card).toHaveAttribute("height", "300");

    // detalle de un pedido en proceso: el selector «Añadir un plato» muestra la foto del producto
    await createOrderViaUI(page, { inProcess: true, dish: "Paella Valenciana" });
    await page.getByRole("button", { name: /En proceso \(1\)/ }).click();
    await dialog(page).getByRole("button", { name: "Abrir" }).click();
    await page.locator("#ticket").getByRole("button", { name: "Añadir un plato" }).click();
    await dialog(page).getByLabel("Buscar plato").fill("con foto");
    const thumb = dialog(page).locator(".pick .thumb img");
    await expect(thumb).toHaveCount(1);
    await expect(thumb).toHaveAttribute("src", url);
    await expect.poll(() => imgLoaded(thumb)).toBe(true);

    // TODAS las peticiones de la imagen fueron al origen de la app: ninguna al de la API (VITE_API_URL)
    expect(mediaRequests.length).toBeGreaterThan(0);
    for (const u of mediaRequests) {
      expect(u.startsWith(`${APP}/media/`), u).toBe(true);
      expect(u.startsWith(API), u).toBe(false);
    }
  });

  test("una imagen heredada con ruta relativa (/paella-valenciana.jpg) tampoco se prefija con la URL de la API", async ({ page }) => {
    const external: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("paella-valenciana.jpg")) external.push(r.url());
    });
    await login(page);
    const img = tile(page, "Paella Valenciana").locator("img");
    await expect(img).toHaveAttribute("src", "/paella-valenciana.jpg");
    await expect.poll(() => imgLoaded(img)).toBe(true);
    expect(external.length).toBeGreaterThan(0);
    expect(external.every((u) => u.startsWith(`${APP}/`))).toBe(true);
  });

  test("una foto de 12 MB se admite: no la rechaza el cliente y el producto se guarda con ella", async ({ page }) => {
    await login(page);
    await openNewDish(page, "Plato foto grande");
    const big = bigPng(12 * 1024 * 1024);
    expect(big.length).toBeGreaterThan(12 * 1024 * 1024);
    expect(big.length).toBeLessThan(15 * 1024 * 1024);
    await expect(dialog(page).getByText("Máximo 15 MB.")).toBeVisible();
    await dialog(page).getByLabel("Elegir foto").setInputFiles({ name: "grande.png", mimeType: "image/png", buffer: big });
    await expect(dialog(page).getByText("Foto lista.")).toBeVisible({ timeout: 20_000 });
    await expect(dialog(page).getByText(/pesa más de/)).toHaveCount(0);
    await expect.poll(() => imgLoaded(dialog(page).locator("img.preview")), { timeout: 20_000 }).toBe(true);
    await dialog(page).getByRole("button", { name: "Crear" }).click();
    await expect(page.locator(".arow .title", { hasText: "Plato foto grande" })).toBeVisible();
    const saved = (await server.catalog()).products.find((p: any) => p.name === "Plato foto grande");
    expect(saved.imageUrl).toMatch(MEDIA_URL);
  });

  test("una foto de más de 15 MB se rechaza en el cliente sin subirla", async ({ page }) => {
    const uploads: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/v1/uploads")) uploads.push(r.url());
    });
    await login(page);
    await openNewDish(page, "Plato foto enorme");
    await dialog(page).getByLabel("Elegir foto").setInputFiles({
      name: "enorme.png",
      mimeType: "image/png",
      buffer: Buffer.concat([PNG_1PX, Buffer.alloc(15 * 1024 * 1024)]),
    });
    await expect(dialog(page).getByText("La foto pesa más de 15 MB.")).toBeVisible();
    await expect(dialog(page).locator("img.preview")).toHaveCount(0);
    expect(uploads).toEqual([]);
  });

  test("la imagen subida por otra vía se sirve en /media del origen de la app, es pública y no depende de que la API esté arriba", async ({ page }) => {
    const up = await apiUpload(PNG_1PX);
    expect(up.status).toBe(201);
    expect(up.body.url).toMatch(MEDIA_URL);
    expect(up.body.url).toBe(`/media/${up.body.key}`);
    // sin Authorization y desde el origen de la app (vite preview -> API / bucket)
    const viaApp = await fetch(`${APP}${up.body.url}`);
    expect(viaApp.status).toBe(200);
    expect(viaApp.headers.get("content-type")).toMatch(/^image\//);
    expect((await viaApp.arrayBuffer()).byteLength).toBeGreaterThan(0);
    // inexistente: 404 (no el index.html de la SPA)
    const missing = await fetch(`${APP}/media/${crypto.randomUUID()}.webp`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-type") ?? "").not.toContain("text/html");

    // y aparece en la Caja aunque la API de /v1 esté caída al cargar la imagen
    const p = await apiCall("POST", "/v1/products", {
      name: "Plato por API", categoryId: "arroces", portionType: "unidades", price: 3, imageUrl: up.body.url,
    });
    expect(p.status).toBe(201);
    await login(page);
    const card = tile(page, "Plato por API").locator("img");
    await card.scrollIntoViewIfNeeded();
    await expect.poll(() => imgLoaded(card)).toBe(true);
    await server.down(true);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Plato por API" })).toBeVisible(); // catálogo desde IndexedDB
    const again = tile(page, "Plato por API").locator("img");
    await again.scrollIntoViewIfNeeded();
    await expect.poll(() => imgLoaded(again)).toBe(true);
    await server.down(false);
  });

  test("subir un fichero que no es imagen da el mensaje por code (415)", async ({ page }) => {
    await login(page);
    await openNewDish(page, "Plato falso");
    await dialog(page).getByLabel("Elegir foto").setInputFiles({
      name: "falso.png", mimeType: "image/png", buffer: Buffer.from("esto no es una imagen"),
    });
    await expect(dialog(page).getByText("Solo se admiten fotos JPG, PNG o WebP.").first()).toBeVisible();
    await expect(dialog(page).locator("img.preview")).toHaveCount(0);
  });
});

test.describe("Imágenes sin conexión (service worker real)", () => {
  test.use({ serviceWorkers: "allow" });

  test("las imágenes de /media quedan en la caché «images» y se ven sin red", async ({ page, context }) => {
    const up = await apiUpload(PNG_1PX);
    expect(up.status).toBe(201);
    expect(
      (await apiCall("POST", "/v1/products", { name: "Plato offline", categoryId: "arroces", portionType: "unidades", price: 3, imageUrl: up.body.url })).status,
    ).toBe(201);
    await login(page);
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      await new Promise<void>((res) => {
        if (reg.active?.state === "activated") return res();
        reg.active?.addEventListener("statechange", () => reg.active?.state === "activated" && res());
      });
    });
    // recarga ya CONTROLADA por el service worker: ahora las imágenes pasan por su regla CacheFirst
    await page.reload();
    const card = tile(page, "Plato offline").locator("img");
    await card.scrollIntoViewIfNeeded();
    await expect.poll(() => imgLoaded(card)).toBe(true);
    await expect
      .poll(() =>
        page.evaluate(async (path) => {
          const cache = await caches.open("images");
          return (await cache.keys()).map((r) => new URL(r.url).pathname).includes(path);
        }, up.body.url),
      )
      .toBe(true);

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Plato offline" })).toBeVisible();
    const offline = tile(page, "Plato offline").locator("img");
    await offline.scrollIntoViewIfNeeded();
    await expect.poll(() => imgLoaded(offline)).toBe(true); // servida desde la caché del service worker
    await context.setOffline(false);
  });
});
