import { test, expect, login, API, createOrderViaUI, server, idbDump, REAL, addDish, payButton, saleRow, tile, apiCall } from "./helpers";
import type { Page } from "@playwright/test";

// Casos que solo tienen sentido (o solo se pueden comprobar) contra el backend REAL:
//   E2E_BACKEND=real npx playwright test real-backend
// Contra el fake se saltan.
test.skip(!REAL, "solo contra el backend real (E2E_BACKEND=real)");

// PNG de 1x1 píxel válido (rojo)
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);

const api = apiCall;

const madridDay = (offsetDays = 0) => {
  const d = new Date(Date.now() - offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(d);
};

const orderBody = (over: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(),
  createdAt: new Date().toISOString(),
  paymentMethod: "efectivo",
  items: [{ productId: "1", name: "Paella Valenciana", unitPrice: 4.5, listPrice: 4.5, quantity: 1, half: false }],
  ...over,
});

test.describe("contrato con el backend real", () => {
  test("cerrar sesión revoca el refresh token EN EL SERVIDOR", async ({ page }) => {
    await login(page);
    const [session] = await idbDump(page, "auth");
    const refreshToken = session.value.refreshToken as string;
    await page.getByRole("link", { name: "Menú" }).click();
    await page.getByRole("button", { name: "Salir" }).click();
    await expect(page.getByRole("button", { name: /Entrar con Microsoft/ })).toBeVisible();
    await expect
      .poll(async () => {
        const r = await fetch(`${API}/v1/auth/refresh`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        });
        return r.status;
      })
      .toBe(401);
  });

  test("DELETE de un pedido ya borrado da 204 y borrar uno inexistente 404 (el cliente lo da por confirmado)", async () => {
    const o = orderBody();
    expect((await api("POST", "/v1/orders", o)).status).toBe(201);
    expect((await api("DELETE", `/v1/orders/${o.id}`)).status).toBe(204);
    expect((await api("DELETE", `/v1/orders/${o.id}`)).status).toBe(204);
    expect((await api("DELETE", `/v1/orders/${crypto.randomUUID()}`)).status).toBe(404);
  });

  test("reorder exige la lista exacta: 409 reorder_mismatch si falta o sobra un id", async () => {
    const ids = (await server.catalog()).products.map((p: any) => p.id);
    const missing = await api("POST", "/v1/products/reorder", { ids: ids.slice(1) });
    expect(missing.status).toBe(409);
    expect(missing.body.code).toBe("reorder_mismatch");
    const extra = await api("POST", "/v1/products/reorder", { ids: [...ids, "no-existe"] });
    expect(extra.status).toBe(409);
    expect((await api("POST", "/v1/products/reorder", { ids: [...ids].reverse() })).status).toBe(204);
  });

  test("reordenar con el menú cambiado en otro dispositivo: aviso y recarga (409 reorder_mismatch)", async ({ page }) => {
    await login(page);
    await page.getByRole("link", { name: "Menú" }).click();
    await expect(page.locator(".arow .title", { hasText: "Paella Valenciana" })).toBeVisible();
    // otro dispositivo añade un producto mientras esta pantalla sigue abierta
    expect(
      (
        await api("POST", "/v1/products", {
          name: "Plato nuevo",
          categoryId: "arroces",
          portionType: "unidades",
          price: 2,
          imageUrl: "/placeholder.svg",
        })
      ).status,
    ).toBe(201);
    await page.getByRole("button", { name: "Bajar Paella Valenciana en el menú" }).click();
    await expect(page.getByText(/El menú cambió en otro sitio/)).toBeVisible();
    await expect(page.locator(".arow .title", { hasText: "Plato nuevo" })).toBeVisible(); // recargado
  });

  test("subida de imagen: la URL devuelta se resuelve desde el origen de la app y la imagen se ve", async ({ page }) => {
    await login(page);
    await page.getByRole("link", { name: "Menú" }).click();
    await page.getByRole("button", { name: "+ Plato nuevo" }).click();
    const dlg = page.getByRole("dialog").last();
    await dlg.getByLabel(/Nombre \(español\)/).fill("Plato con foto");
    await dlg.getByLabel(/Precio ración/).fill("5");
    await dlg.getByLabel("Elegir foto").setInputFiles({ name: "foto.png", mimeType: "image/png", buffer: PNG_1PX });
    await expect(dlg.getByText("Foto lista.")).toBeVisible();
    const loaded = (loc: ReturnType<Page["locator"]>) =>
      loc.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0);
    const preview = dlg.locator("img.preview");
    await expect.poll(() => loaded(preview)).toBe(true); // vista previa
    const url = (await preview.getAttribute("src"))!;
    // la URL devuelta es absoluta (PUBLIC_BASE_URL) y la imagen es pública, inmutable y legible entre orígenes
    expect(url).toMatch(/^https?:\/\/.*\/v1\/uploads\/[\w-]+\.png$/);
    const img = await fetch(url);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(img.headers.get("cache-control")).toContain("immutable");
    expect(Buffer.from(await img.arrayBuffer()).equals(PNG_1PX)).toBe(true);

    await dlg.getByRole("button", { name: "Crear" }).click();
    const row = page.locator(".arow", { hasText: "Plato con foto" }).first();
    await expect(row).toBeVisible();
    await expect.poll(() => loaded(row.locator("img").first())).toBe(true); // se ve en el Menú

    await page.getByRole("link", { name: "Caja", exact: true }).click();
    await expect.poll(() => loaded(tile(page, "Plato con foto").locator("img"))).toBe(true); // se ve en la Caja
  });

  test("subida de un fichero que no es imagen: 415 y mensaje por code", async ({ page }) => {
    await login(page);
    await page.getByRole("link", { name: "Menú" }).click();
    await page.getByRole("button", { name: "+ Plato nuevo" }).click();
    await page.getByRole("dialog").last().getByLabel("Elegir foto").setInputFiles({
      name: "falso.png",
      mimeType: "image/png", // la cabecera miente: el servidor mira los bytes
      buffer: Buffer.from("esto no es una imagen"),
    });
    await expect(page.getByText("Solo se admiten fotos JPG, PNG o WebP.").first()).toBeVisible();
    await expect(page.locator("img.preview")).toHaveCount(0);
  });

  test("resumen del día = GET /reports/daily (importes en euros por forma de pago, sin cancelados)", async ({ page }) => {
    await login(page);
    await createOrderViaUI(page, { payment: "Tarjeta" });
    await createOrderViaUI(page, { dish: "Arroz de marisco", payment: "Bizum" });
    await createOrderViaUI(page, { dish: "Lata de refresco", payment: "Efectivo", inProcess: true });
    const cancelled = orderBody({ status: "cancelado", paymentMethod: "bizum" });
    await api("POST", "/v1/orders", cancelled);

    const day = madridDay();
    const { body: rows } = await api("GET", `/v1/reports/daily?from=${day}&to=${day}`);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.orders).toBe(3);
    expect(r.cancelled.orders).toBe(1);

    await page.goto("/ventas");
    const eur = (n: number) => n.toFixed(2).replace(".", ",");
    await expect(page.getByTestId("day-total")).toContainText(eur(r.total));
    for (const m of ["efectivo", "tarjeta", "bizum"] as const)
      await expect(page.getByTestId(`pay-${m}`)).toContainText(eur(r.byPaymentMethod[m]));
    await expect(page.getByText(new RegExp(`Anuladas: ${r.cancelled.orders} venta`))).toBeVisible();
  });

  test("selector de fechas: solo se ofrecen los días de /orders/days y cada día tiene su numeración", async ({ page }) => {
    const old = new Date(Date.now() - 3 * 86_400_000).toISOString();
    await api("POST", "/v1/orders", orderBody({ createdAt: old }));
    await api("POST", "/v1/orders", orderBody({ createdAt: old }));
    await api("POST", "/v1/orders", orderBody());
    const days = (await api("GET", "/v1/orders/days")).body as { day: string; count: number }[];
    expect(days.map((d) => d.count).sort()).toEqual([1, 2]);

    await login(page);
    await page.goto("/ventas");
    await expect(saleRow(page, 1)).toBeVisible(); // hoy
    const select = page.getByLabel("Otro día:");
    await expect(select.locator("option")).toHaveCount(days.length);
    await select.selectOption(madridDay(3));
    await expect(saleRow(page, 2)).toBeVisible();
    await expect(saleRow(page, 1)).toBeVisible();
    await expect(page.locator(".srow")).toHaveCount(2);
  });

  test("CSV del día: la descarga trae el BOM UTF-8 y una fila por línea", async ({ page }) => {
    await login(page);
    await createOrderViaUI(page);
    await page.goto("/ventas");
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Descargar el día (CSV)" }).click()]);
    expect(download.suggestedFilename()).toMatch(/^ventas-\d{4}-\d{2}-\d{2}\.csv$/);
    const fs = await import("node:fs/promises");
    const text = await fs.readFile((await download.path())!, "utf8");
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain("Paella Valenciana");
  });

  test("corregir en Ventas contra el servidor real: añadir un producto con If-Match y recalcular el total", async ({ page }) => {
    await login(page);
    await createOrderViaUI(page); // 4,50
    await page.goto("/ventas");
    await saleRow(page, 1).getByRole("button", { name: "Ver" }).click();
    await page.getByRole("dialog").last().getByRole("button", { name: "Corregir" }).click();
    const dlg = page.getByRole("dialog").last();
    await dlg.getByRole("button", { name: "Añadir un plato" }).click();
    await page.getByRole("dialog").last().getByLabel("Buscar plato").fill("lata de ref");
    await page.getByRole("dialog").last().getByRole("button", { name: /Añadir Añadir de Lata de refresco/ }).click();
    await page.getByRole("dialog").last().getByRole("button", { name: "Listo" }).click();
    await page.getByRole("dialog").last().getByRole("button", { name: "Guardar" }).click();
    await expect(saleRow(page, 1)).toContainText("6,50");
    const [o] = await server.orders();
    expect(o.total).toBe(6.5); // calculado por el servidor
    expect(o.revision).toBe(2);
  });
});

test.describe("sin conexión contra el backend real", () => {
  test("varios pedidos sin conexión: se sincronizan en orden, con número definitivo y la cola de IndexedDB queda vacía", async ({
    page,
    context,
  }) => {
    await login(page);
    await page.getByRole("link", { name: "Ventas" }).click(); // descarga la ruta diferida antes de cortar
    await expect(page.getByRole("heading", { level: 1, name: "Ventas" })).toBeVisible();
    await page.getByRole("link", { name: "Caja", exact: true }).click();
    await context.setOffline(true);
    for (const dish of ["Paella Valenciana", "Arroz de marisco"]) {
      await addDish(page, dish);
      await payButton(page).click();
      await page.getByRole("dialog").last().getByRole("button", { name: "Confirmar" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
    expect(await idbDump(page, "outbox")).toHaveLength(2);
    const clientTimes = (await idbDump(page, "outbox")).map((e) => e.payload.createdAt as string);
    expect(await server.orders()).toHaveLength(0);

    await context.setOffline(false);
    await expect.poll(async () => (await server.orders()).length, { timeout: 20_000 }).toBe(2);
    await expect.poll(async () => (await idbDump(page, "outbox")).length).toBe(0);
    expect(await idbDump(page, "outbox_failed")).toHaveLength(0);
    const orders = await server.orders();
    expect(orders.map((o: any) => o.number)).toEqual([1, 2]); // FIFO
    expect(orders.map((o: any) => o.createdAt)).toEqual(clientTimes.map((t) => new Date(t).toISOString())); // hora del dispositivo
    expect(orders.map((o: any) => o.items[0].name)).toEqual(["Paella Valenciana", "Arroz de marisco"]);
  });

  test("reintento idempotente: la respuesta se pierde, el cliente reenvía el mismo id y no hay duplicado", async ({ page }) => {
    await login(page);
    let first = true;
    let posts = 0;
    await page.route("**/v1/orders", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      posts++;
      if (first) {
        first = false;
        await route.fetch(); // el servidor SÍ crea el pedido…
        return route.abort("connectionreset"); // …pero la respuesta no llega
      }
      return route.continue(); // el reintento: 200 con el pedido existente
    });
    await createOrderViaUI(page);
    await expect.poll(async () => posts, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
    await expect.poll(async () => (await idbDump(page, "outbox")).length, { timeout: 20_000 }).toBe(0);
    const orders = await server.orders();
    expect(orders).toHaveLength(1);
    expect(orders[0].number).toBe(1);
    expect(await idbDump(page, "outbox_failed")).toHaveLength(0);
  });

  test("edición sin conexión de un pedido en proceso que cambió en el servidor: 412 y se descarta con aviso", async ({
    page,
    context,
  }) => {
    await login(page);
    await createOrderViaUI(page, { inProcess: true });
    await page.goto("/");
    await expect(page.getByRole("button", { name: /En proceso \(1\)/ })).toBeVisible();
    const [o] = await server.orders();
    expect(o.revision).toBe(1);
    await page.getByRole("button", { name: /En proceso \(1\)/ }).click();
    await page.getByRole("dialog").last().getByRole("button", { name: "Abrir" }).click();

    await context.setOffline(true);
    await page.locator("#ticket").getByRole("button", { name: /Añadir uno más/ }).click();
    await page.locator("#ticket").getByRole("button", { name: "Guardar cambios" }).click();
    await expect.poll(async () => (await idbDump(page, "outbox")).length).toBe(1);
    expect((await idbDump(page, "outbox"))[0]).toMatchObject({ kind: "patch", baseRevision: 1 });

    // mientras tanto, otro dispositivo lo completa (revision 2)
    expect((await api("PATCH", `/v1/orders/${o.id}`, { status: "completado" }, { "if-match": '"1"' })).status).toBe(200);

    await context.setOffline(false);
    await expect(page.getByText(/Un cambio hecho sin conexión se descartó/)).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await idbDump(page, "outbox")).length).toBe(0);
    const [after] = await server.orders();
    expect(after).toMatchObject({ status: "completado", revision: 2 });
    expect(after.items[0].quantity).toBe(1);
  });

  test("editar sin conexión un pedido en proceso del servidor y sincronizar: If-Match correcto, revisión 2", async ({
    page,
    context,
  }) => {
    await login(page);
    await createOrderViaUI(page, { inProcess: true });
    await page.goto("/");
    await page.getByRole("button", { name: /En proceso \(1\)/ }).click();
    await page.getByRole("dialog").last().getByRole("button", { name: "Abrir" }).click();
    await context.setOffline(true);
    await page.locator("#ticket").getByRole("button", { name: "Anular pedido" }).click();
    await page.getByRole("dialog").last().getByRole("button", { name: "Sí, anular" }).click();
    await expect.poll(async () => (await idbDump(page, "outbox")).length).toBe(1);
    await context.setOffline(false);
    await expect.poll(async () => (await server.orders())[0]?.status, { timeout: 20_000 }).toBe("cancelado");
    expect((await server.orders())[0].revision).toBe(2);
    await expect.poll(async () => (await idbDump(page, "outbox")).length).toBe(0);
  });
});
