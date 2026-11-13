import { test, expect, login, createOrderViaUI, server, idbDump, tile, ticket, payButton, addDish, saleRow, apiOrder } from "./helpers";

const dialog = (page: import("@playwright/test").Page) => page.getByRole("dialog").last();

test.describe("Caja: flujo crítico contra el servidor", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("la Caja carga el menú del servidor y el filtro por sección usa aria-pressed", async ({ page }) => {
    await expect(page.getByRole("link", { name: "Caja", exact: true })).toHaveAttribute("aria-current", "page");
    const group = page.getByRole("group", { name: "Sección del menú" });
    await group.getByRole("button", { name: "Bebidas" }).click();
    await expect(group.getByRole("button", { name: "Bebidas" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("heading", { name: "Paella Valenciana" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Lata de refresco" })).toBeVisible();
  });

  test("crear pedido con ración completa y media, pagar con Bizum, verlo en Ventas", async ({ page }) => {
    await addDish(page, "Paella Valenciana");
    await tile(page, "Paella Valenciana").getByRole("button", { name: /Cobrar Media/ }).click();
    await expect(ticket(page).locator(".total-row .big")).toContainText("7,50"); // 4,50 + 3,00
    await payButton(page).click();
    await dialog(page).getByRole("button", { name: "Bizum", exact: true }).click();
    await dialog(page).getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Venta 1 guardada/ })).toBeVisible();

    await page.getByRole("link", { name: "Ventas" }).click();
    await expect(page).toHaveURL(/\/ventas$/);
    await expect(saleRow(page, 1)).toContainText("7,50");
    await expect(saleRow(page, 1)).toContainText("Bizum");
    await expect(page.getByTestId("day-total")).toContainText("7,50");

    const [o] = await server.orders();
    expect(o).toMatchObject({ number: 1, paymentMethod: "bizum", status: "completado" });
    expect(o.items.map((i: any) => [i.half, i.unitPrice, i.listPrice])).toEqual([
      [false, 4.5, 4.5],
      [true, 3, 3],
    ]);
  });

  test("calculadora de efectivo: 20 € sobre 13,50 € devuelve 6,50 €; el cambio se muestra en el aviso", async ({ page }) => {
    for (let i = 0; i < 3; i++) await addDish(page, "Paella Valenciana");
    await payButton(page).click();
    await dialog(page).getByRole("button", { name: "20 €" }).click();
    await expect(dialog(page).locator(".change-big")).toContainText("6,50");
    await dialog(page).getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Devolver.*6,50/ })).toBeVisible();
    await expect.poll(async () => (await server.orders())[0]?.amountReceived).toBe(20);
  });

  test("los pedidos están en el servidor: sobreviven a una recarga y la numeración continúa", async ({ page }) => {
    await createOrderViaUI(page);
    await createOrderViaUI(page);
    await page.goto("/ventas");
    await page.reload();
    await expect(saleRow(page, 1)).toBeVisible();
    await expect(saleRow(page, 2)).toBeVisible();
    await createOrderViaUI(page);
    await page.goto("/ventas");
    await expect(saleRow(page, 3)).toBeVisible();
  });

  test("anti doble toque: un doble clic en Confirmar crea un solo pedido", async ({ page }) => {
    await addDish(page, "Paella Valenciana");
    await payButton(page).click();
    await dialog(page).getByRole("button", { name: "Confirmar" }).dblclick();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect.poll(async () => (await server.orders()).length).toBe(1);
    await page.waitForTimeout(500);
    expect((await server.orders()).length).toBe(1);
  });

  test("«Dejar en proceso» (desactivado por defecto) crea el pedido en proceso", async ({ page }) => {
    await addDish(page, "Paella Valenciana");
    await payButton(page).click();
    const sw = dialog(page).getByRole("switch", { name: "Dejar en proceso" });
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await sw.click();
    await dialog(page).getByRole("button", { name: "Guardar en proceso" }).click();
    await expect.poll(async () => (await server.orders())[0]?.status).toBe("en_proceso");
    await expect(page.getByRole("button", { name: /En proceso \(1\)/ })).toBeVisible();
  });

  test("Agotado: el plato se ve pero no se puede añadir", async ({ page }) => {
    await page.getByRole("link", { name: "Menú" }).click();
    await page.locator('[data-product="4"]').getByRole("switch", { name: "Disponible" }).click();
    await expect(page.locator('[data-product="4"]').getByRole("switch", { name: "Agotado" })).toBeVisible();
    await page.getByRole("link", { name: "Caja", exact: true }).click();
    await expect(tile(page, "Lata de refresco")).toContainText("Agotado");
    await expect(tile(page, "Lata de refresco").getByRole("button")).toHaveCount(0);
    // una ración sin precio de media solo ofrece «Ración»
    await expect(tile(page, "Croqueta de jamón").getByRole("button", { name: /Media/ })).toHaveCount(0);
  });

  test("completado: solo lectura en la Caja (no aparece en «En proceso»); en Ventas sí se corrige", async ({ page }) => {
    await createOrderViaUI(page);
    await expect(page.getByRole("button", { name: /En proceso \(0\)/ })).toBeVisible();
    await page.getByRole("button", { name: /En proceso/ }).click();
    await expect(dialog(page).getByText("No hay pedidos en proceso")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("link", { name: "Ventas" }).click();
    await saleRow(page, 1).getByRole("button", { name: "Ver" }).click();
    await expect(dialog(page).getByRole("button", { name: "Corregir" })).toBeVisible();
  });

  test("en proceso → Anular desde la Caja (con confirmación) y queda anulado", async ({ page }) => {
    await createOrderViaUI(page, { inProcess: true });
    await page.getByRole("button", { name: /En proceso \(1\)/ }).click();
    await dialog(page).getByRole("button", { name: "Abrir" }).click();
    await ticket(page).getByRole("button", { name: "Anular pedido" }).click();
    await dialog(page).getByRole("button", { name: "Sí, anular" }).click();
    await expect.poll(async () => (await server.orders())[0].status).toBe("cancelado");
    await page.goto("/ventas");
    await expect(saleRow(page, 1)).toContainText("Anulada");
  });

  test("en proceso: editar cantidad, precio unitario y forma de pago persiste en el servidor", async ({ page }) => {
    await createOrderViaUI(page, { inProcess: true });
    await page.getByRole("button", { name: /En proceso \(1\)/ }).click();
    await dialog(page).getByRole("button", { name: "Abrir" }).click();
    await ticket(page).getByRole("button", { name: /Añadir uno más/ }).click();
    await ticket(page).getByRole("button", { name: /Cambiar el precio/ }).click();
    await dialog(page).getByLabel("Precio de cada uno (€)").fill("4");
    await dialog(page).getByRole("button", { name: "Guardar" }).click();
    await ticket(page).getByRole("button", { name: "Tarjeta", exact: true }).click();
    await ticket(page).getByRole("button", { name: "Guardar cambios" }).click();
    await expect.poll(async () => (await server.orders())[0].revision).toBe(2);
    const [o] = await server.orders();
    expect(o).toMatchObject({ paymentMethod: "tarjeta", status: "en_proceso" });
    expect(o.items[0]).toMatchObject({ quantity: 2, unitPrice: 4, listPrice: 4.5 });
  });

  test("AÑADIR un producto a un pedido en proceso desde su detalle (búsqueda, entera/media)", async ({ page }) => {
    await createOrderViaUI(page, { inProcess: true });
    await page.getByRole("button", { name: /En proceso \(1\)/ }).click();
    await dialog(page).getByRole("button", { name: "Abrir" }).click();
    await ticket(page).getByRole("button", { name: "Añadir un plato" }).click();
    await dialog(page).getByLabel("Buscar plato").fill("arroz");
    await expect(dialog(page).getByText("Paella Valenciana")).toHaveCount(0);
    await dialog(page).getByRole("button", { name: /Añadir Media de Arroz de marisco/ }).click();
    await dialog(page).getByRole("button", { name: "Listo" }).click();
    await ticket(page).getByRole("button", { name: "Guardar cambios" }).click();
    await expect.poll(async () => (await server.orders())[0].items.length).toBe(2);
    const [o] = await server.orders();
    expect(o.items.map((i: any) => [i.productId, i.half])).toEqual([["1", false], ["2", true]]);
    expect(o.revision).toBe(2);
  });

  test("ración completa y media del mismo plato son líneas distintas en el ticket", async ({ page }) => {
    await addDish(page, "Paella Valenciana");
    await tile(page, "Paella Valenciana").getByRole("button", { name: /Cobrar Media/ }).click();
    await addDish(page, "Paella Valenciana");
    await expect(ticket(page).locator("li.tl")).toHaveCount(2);
    await expect(ticket(page).locator("li.tl").first()).toContainText("2");
    await expect(ticket(page).locator(".total-row .big")).toContainText("12,00"); // 2×4,50 + 3,00
  });
});

test.describe("Ventas (servidor): resumen, corrección y borrado", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("resumen del día: ingresos sin anulados, desglose por pago y línea de anulados", async ({ page }) => {
    await createOrderViaUI(page, { payment: "Tarjeta" }); // 4,50
    await createOrderViaUI(page, { dish: "Arroz de marisco", payment: "Efectivo" }); // 4,50
    await createOrderViaUI(page, { dish: "Lata de refresco", payment: "Bizum", inProcess: true }); // 2,00 → se anula
    await page.getByRole("button", { name: /En proceso \(1\)/ }).click();
    await dialog(page).getByRole("button", { name: "Abrir" }).click();
    await ticket(page).getByRole("button", { name: "Anular pedido" }).click();
    await dialog(page).getByRole("button", { name: "Sí, anular" }).click();
    await expect.poll(async () => (await server.orders())[2].status).toBe("cancelado");
    await page.getByRole("link", { name: "Ventas" }).click();
    await expect(page.getByTestId("day-total")).toContainText("9,00");
    await expect(page.getByTestId("pay-tarjeta")).toContainText("4,50");
    await expect(page.getByTestId("pay-efectivo")).toContainText("4,50");
    await expect(page.getByTestId("pay-bizum")).toContainText("0,00");
    await expect(page.getByText(/Anuladas: 1 venta · 2,00.*No se suman al total/)).toBeVisible();
  });

  test("corregir CUALQUIER pedido: un completado cambia de forma de pago y recibe un plato nuevo", async ({ page }) => {
    await createOrderViaUI(page);
    await page.goto("/ventas");
    await saleRow(page, 1).getByRole("button", { name: "Ver" }).click();
    await dialog(page).getByRole("button", { name: "Corregir" }).click();
    await dialog(page).getByLabel("Forma de pago").selectOption("bizum");
    await dialog(page).getByRole("button", { name: "Añadir un plato" }).click();
    await dialog(page).getByLabel("Buscar plato").fill("lata");
    await dialog(page).getByRole("button", { name: /Añadir Añadir de Lata de refresco/ }).click();
    await dialog(page).getByRole("button", { name: "Listo" }).click();
    await dialog(page).getByRole("button", { name: "Guardar" }).click();
    await expect.poll(async () => (await server.orders())[0].revision).toBe(2);
    const [o] = await server.orders();
    expect(o).toMatchObject({ paymentMethod: "bizum", status: "completado" });
    expect(o.items.map((i: any) => i.productId)).toEqual(["1", "4"]);
    await expect(saleRow(page, 1)).toContainText("6,50");
  });

  test("borrar un pedido con confirmación es un borrado lógico; cancelar la confirmación lo conserva", async ({ page }) => {
    await createOrderViaUI(page);
    await page.goto("/ventas");
    await saleRow(page, 1).getByRole("button", { name: "Ver" }).click();
    await dialog(page).getByRole("button", { name: "Borrar" }).click();
    await dialog(page).getByRole("button", { name: "No, volver" }).click();
    expect((await server.orders())[0].deletedAt).toBeNull();
    await dialog(page).getByRole("button", { name: "Borrar" }).click();
    await dialog(page).getByRole("button", { name: "Sí, borrar" }).click();
    await expect(page.getByText("Sin ventas este día")).toBeVisible();
    await page.reload();
    await expect(page.getByText("Sin ventas este día")).toBeVisible();
    expect((await server.orders())[0].deletedAt).not.toBeNull();
  });

  test("el selector de días solo ofrece los días con pedidos", async ({ page }) => {
    await createOrderViaUI(page);
    const old = new Date(Date.now() - 5 * 86_400_000).toISOString();
    expect((await apiOrder({ createdAt: old })).status).toBe(201);
    await page.goto("/ventas");
    const select = page.getByLabel("Otro día:");
    await expect(select.locator("option")).toHaveCount(2); // hoy y hace 5 días; ningún otro
    await select.selectOption({ index: 1 });
    await expect(page.locator(".srow")).toHaveCount(1);
    await expect(page.locator(".srow")).toContainText("nº 1");
  });
});

test.describe("sin conexión y sincronización", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("sin conexión se sigue creando pedidos (P-1, indicador) y se envían al volver la red", async ({ page, context }) => {
    // (sin service worker en este test) se descarga antes la pantalla de Ventas, que es una ruta diferida
    await page.getByRole("link", { name: "Ventas" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Ventas" })).toBeVisible();
    await page.getByRole("link", { name: "Caja", exact: true }).click();
    await context.setOffline(true);
    await addDish(page, "Paella Valenciana");
    await payButton(page).click();
    await dialog(page).getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByRole("status").filter({ hasText: /Venta P-1 guardada/ })).toBeVisible();
    await expect(page.getByText("Pendiente de enviar")).toBeVisible();
    await expect(page.getByRole("button", { name: /1 sin enviar/ })).toBeVisible();

    // historial sin conexión = solo pendientes locales + aviso
    await page.getByRole("link", { name: "Ventas" }).click();
    await expect(page.locator(".srow", { hasText: "P-1" })).toBeVisible();
    await expect(page.locator(".srow .chip.pending")).toBeVisible();
    await expect(page.getByText(/solo se ven los pedidos sin enviar/)).toBeVisible();
    expect(await server.orders()).toHaveLength(0);

    await context.setOffline(false);
    await expect.poll(async () => (await server.orders()).length, { timeout: 15_000 }).toBe(1);
    await expect(saleRow(page, 1)).toBeVisible(); // número definitivo del servidor
    await expect(page.locator(".chip.pending")).toHaveCount(0);
  });

  test("el pedido pendiente vive en la cola de IndexedDB y se borra de ella cuando el servidor lo confirma", async ({ page, context }) => {
    await context.setOffline(true);
    await addDish(page, "Paella Valenciana");
    await payButton(page).click();
    await dialog(page).getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByText(/Venta P-1 guardada/)).toBeVisible();
    const queued = await idbDump(page, "outbox");
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ kind: "create", provisional: 1 });
    await context.setOffline(false);
    await expect.poll(async () => (await server.orders()).length, { timeout: 15_000 }).toBe(1);
    await expect.poll(async () => (await idbDump(page, "outbox")).length).toBe(0);
  });

  test("DESCARTAR un pedido pendiente (con confirmación): se borra su entrada create y nunca llega al servidor", async ({ page, context }) => {
    await context.setOffline(true);
    await addDish(page, "Paella Valenciana");
    await payButton(page).click();
    await dialog(page).getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByText(/Venta P-1 guardada/)).toBeVisible();
    expect(await idbDump(page, "outbox")).toHaveLength(1);

    await page.getByRole("button", { name: /1 sin enviar/ }).click();
    await dialog(page).getByRole("button", { name: "Descartar" }).click();
    await dialog(page).getByRole("button", { name: "No, volver" }).click(); // la confirmación se puede rechazar
    expect(await idbDump(page, "outbox")).toHaveLength(1);
    await dialog(page).getByRole("button", { name: "Descartar" }).click();
    await dialog(page).getByRole("button", { name: "Sí, descartar" }).click();
    await expect.poll(async () => (await idbDump(page, "outbox")).length).toBe(0);
    expect(await idbDump(page, "outbox_failed")).toHaveLength(0);

    await context.setOffline(false);
    await page.waitForTimeout(1500);
    expect(await server.orders()).toHaveLength(0); // sin rastro en el servidor
    await expect(page.getByRole("button", { name: /sin enviar/ })).toHaveCount(0);
  });

  test("un pedido ya sincronizado no ofrece «Descartar» (ni en el diálogo de pendientes ni en En proceso)", async ({ page }) => {
    await createOrderViaUI(page, { inProcess: true });
    await page.getByRole("button", { name: /En proceso \(1\)/ }).click();
    await expect(dialog(page).getByRole("button", { name: "Abrir" })).toBeVisible();
    await expect(dialog(page).getByRole("button", { name: "Descartar" })).toHaveCount(0);
  });

  test("con el servidor caído (503) el pedido queda pendiente y se reintenta con espera", async ({ page }) => {
    await server.down(true);
    await addDish(page, "Paella Valenciana");
    await payButton(page).click();
    await dialog(page).getByRole("button", { name: "Confirmar" }).click();
    await expect(page.getByRole("button", { name: /1 sin enviar/ })).toBeVisible();
    await server.down(false);
    await expect.poll(async () => (await server.orders()).length, { timeout: 20_000 }).toBe(1);
    await expect(page.getByRole("button", { name: /sin enviar/ })).toHaveCount(0);
  });

  test("con el token caducado se refresca solo y el pedido llega", async ({ page }) => {
    await server.expireTokens();
    await createOrderViaUI(page);
    await expect.poll(async () => (await server.orders()).length).toBe(1);
  });
});
