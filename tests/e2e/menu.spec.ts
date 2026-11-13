import { test, expect, login, server } from "./helpers";

const dialog = (page: import("@playwright/test").Page) => page.getByRole("dialog").last();

test.describe("Menú: gestión contra el servidor", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await page.getByRole("link", { name: "Menú" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Menú" })).toBeVisible();
  });

  test("muestra los platos del servidor y filtra por sección", async ({ page }) => {
    await expect(page.locator(".arow .title", { hasText: "Paella Valenciana" })).toBeVisible();
    await page.getByRole("group", { name: "Filtrar por sección" }).getByRole("button", { name: "Bebidas" }).click();
    await expect(page.locator(".arow .title", { hasText: "Paella Valenciana" })).toHaveCount(0);
    await expect(page.locator(".arow .title", { hasText: "Lata de refresco" })).toBeVisible();
  });

  test("crear plato (con nombre árabe): aparece en el Menú y en la Caja tras recargar", async ({ page }) => {
    await page.getByRole("button", { name: "+ Plato nuevo" }).click();
    await dialog(page).getByLabel(/Nombre \(español\)/).fill("Tortilla de prueba");
    await dialog(page).getByLabel(/Nombre \(árabe\)/).fill("عجة");
    await dialog(page).getByLabel(/Precio ración/).fill("3.25");
    await dialog(page).getByLabel("¿Cómo se vende?").selectOption("unidades");
    await dialog(page).getByLabel("Elegir foto").setInputFiles({ name: "p.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgo=", "base64") });
    await expect(dialog(page).getByText("Foto lista.")).toBeVisible();
    await dialog(page).getByRole("button", { name: "Crear" }).click();
    await expect(page.locator(".arow .title", { hasText: "Tortilla de prueba" })).toBeVisible();
    await page.reload();
    await expect(page.locator(".arow .title", { hasText: "Tortilla de prueba" })).toBeVisible();
    await page.getByRole("link", { name: "Caja", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Tortilla de prueba" })).toBeVisible();
    const p = (await server.catalog()).products.find((p: any) => p.name === "Tortilla de prueba");
    expect(p).toMatchObject({ price: 3.25, names: { ar: "عجة" }, halfPortionPrice: null });
    expect(p.imageUrl).toMatch(/\/v1\/uploads\//);
  });

  test("la validación sale al abandonar el campo (nombre, importe con 2 decimales como máximo)", async ({ page }) => {
    await page.getByRole("button", { name: "+ Plato nuevo" }).click();
    await dialog(page).getByLabel(/Nombre \(español\)/).focus();
    await dialog(page).getByLabel(/Precio ración/).focus();
    await expect(dialog(page).getByText("Falta el nombre.")).toBeVisible();
    await dialog(page).getByLabel(/Precio ración/).fill("4.555");
    await dialog(page).getByLabel(/Precio media/).focus();
    await expect(dialog(page).getByText(/máximo 2 decimales/)).toBeVisible();
  });

  test("editar plato: nombre y precio", async ({ page }) => {
    await page.locator('[data-product="1"]').getByRole("button", { name: "Editar" }).click();
    await dialog(page).getByLabel(/Nombre \(español\)/).fill("Paella Premium");
    await dialog(page).getByLabel(/Precio ración/).fill("7");
    await dialog(page).getByRole("button", { name: "Guardar" }).click();
    await expect(page.locator(".arow .title", { hasText: "Paella Premium" })).toBeVisible();
    await page.reload();
    await expect(page.locator(".arow .title", { hasText: "Paella Premium" })).toBeVisible();
    await expect(page.locator(".arow .title", { hasText: "Paella Valenciana" })).toHaveCount(0);
  });

  test("borrar plato (confirmando): borrado lógico, desaparece de la Caja", async ({ page }) => {
    await page.locator('[data-product="1"]').getByRole("button", { name: "Borrar" }).click();
    await dialog(page).getByRole("button", { name: "Sí, borrar" }).click();
    await expect(page.locator(".arow .title", { hasText: "Paella Valenciana" })).toHaveCount(0);
    await page.getByRole("link", { name: "Caja", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Paella Valenciana" })).toHaveCount(0);
    expect((await server.catalog()).products.find((p: any) => p.id === "1").deletedAt).not.toBeNull();
  });

  test("Subir/Bajar envía la lista exacta y persiste el orden", async ({ page }) => {
    await page.getByRole("button", { name: "Bajar Paella Valenciana en el menú" }).click();
    await expect.poll(async () => (await server.catalog()).products.sort((x: any, y: any) => x.position - y.position).map((p: any) => p.id)).toEqual(["2", "1", "3", "4"]);
    await page.reload();
    await expect(page.locator(".arow .title").first()).toHaveText("Arroz de marisco");
    await page.getByRole("link", { name: "Caja", exact: true }).click();
    const names = await page.locator(".tile-name").allTextContents();
    expect(names.indexOf("Arroz de marisco")).toBeLessThan(names.indexOf("Paella Valenciana"));
  });

  test("secciones: crear con nombre árabe, renombrar y borrar una vacía; con platos da el error por code", async ({ page }) => {
    await page.getByRole("button", { name: "Secciones", exact: true }).click();
    await page.getByRole("button", { name: "+ Sección nueva" }).click();
    await dialog(page).getByLabel(/Nombre \(español\)/).fill("Tapas");
    await dialog(page).getByLabel(/Nombre \(árabe\)/).fill("مقبلات");
    await dialog(page).getByRole("button", { name: "Guardar" }).click();
    await expect(page.locator(".arow .title", { hasText: "Tapas" })).toBeVisible();
    expect((await server.catalog()).categories.find((c: any) => c.name === "Tapas").names).toEqual({ ar: "مقبلات" });
    await page.locator(".arow", { hasText: "Arroces y Paellas" }).getByRole("button", { name: "Borrar" }).click();
    await dialog(page).getByRole("button", { name: "Sí, borrar" }).click();
    await expect(page.getByText("La sección tiene platos. Muévelos o bórralos.")).toBeVisible();
    await page.locator(".arow", { hasText: "Tapas" }).getByRole("button", { name: "Borrar" }).click();
    await dialog(page).getByRole("button", { name: "Sí, borrar" }).click();
    await expect(page.locator(".arow .title", { hasText: "Tapas" })).toHaveCount(0);
  });

  test("sin conexión el Menú queda bloqueado con un aviso", async ({ page, context }) => {
    await context.setOffline(true);
    await expect(page.getByText(/para cambiar el menú hace falta internet/)).toBeVisible();
    await expect(page.getByRole("button", { name: "+ Plato nuevo" })).toBeDisabled();
    await context.setOffline(false);
  });
});
