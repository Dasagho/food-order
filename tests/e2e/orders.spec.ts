import { test, expect } from "@playwright/test";
import { createOrderViaUI } from "./helpers";

test.describe("pedidos: flujo crítico", () => {
  test("home carga el menú y la búsqueda filtra", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Paella Valenciana")).toBeVisible();
    await page.getByPlaceholder("Buscar platos...").fill("zzzz");
    await expect(page.getByText("No se encontraron platos")).toBeVisible();
    await page.getByPlaceholder("Buscar platos...").fill("paella");
    await expect(page.getByText("Paella Valenciana")).toBeVisible();
  });

  test("crear pedido con ración completa y media, pagar con Bizum, verlo en Pedidos", async ({ page }) => {
    await page.goto("/");
    const card = page.locator("div.overflow-hidden", { hasText: "Paella Valenciana" }).first();
    await card.getByRole("button", { name: /Ración Completa/ }).click();
    await card.getByRole("button", { name: /Media Ración/ }).click();
    await page.getByRole("button", { name: /Ver pedido/ }).click();
    await expect(page.getByText("€7.50").first()).toBeVisible(); // 4.5 + 3
    await page.getByRole("button", { name: "Bizum", exact: true }).click();
    await page.getByRole("button", { name: /Confirmar Pedido/ }).click();
    await expect(page.getByText(/Pedido guardado localmente/)).toBeVisible();

    await page.getByRole("button", { name: /Ver Pedidos/ }).click();
    await expect(page).toHaveURL(/\/pedidos$/);
    await expect(page.getByText("Pedido #1")).toBeVisible();
    await expect(page.getByText("€7.50").first()).toBeVisible();
    await expect(page.getByText(/1\s+pedido\b/)).toBeVisible();
  });

  test("los pedidos sobreviven a una recarga y la numeración continúa", async ({ page }) => {
    await createOrderViaUI(page);
    await createOrderViaUI(page);
    await page.goto("/pedidos");
    await page.reload();
    await expect(page.getByText("Pedido #1")).toBeVisible();
    await expect(page.getByText("Pedido #2")).toBeVisible();
    await createOrderViaUI(page);
    await page.goto("/pedidos");
    await expect(page.getByText("Pedido #3")).toBeVisible();
  });

  test("cambiar estado a Cancelado desde el detalle", async ({ page }) => {
    await createOrderViaUI(page);
    await page.goto("/pedidos");
    await page.getByRole("button", { name: /Editar Pedido/ }).click();
    await page.getByRole("button", { name: "Cancelado" }).click();
    await expect(page.locator("span", { hasText: /^Cancelado$/ })).toBeVisible();
    await page.reload();
    await expect(page.locator("span", { hasText: /^Cancelado$/ })).toBeVisible();
  });

  test("editar cantidades recalcula el total y persiste", async ({ page }) => {
    await createOrderViaUI(page);
    await page.goto("/pedidos");
    await page.getByRole("button", { name: /Editar Pedido/ }).click();
    await page.getByRole("button", { name: /Editar Pedido/ }).last().click();
    await page.locator("svg.lucide-plus").first().locator("xpath=ancestor::button").click();
    await page.getByRole("button", { name: /Guardar Cambios/ }).click();
    // el modal se cierra solo cuando la escritura ha terminado
    await expect(page.getByRole("button", { name: /Guardar Cambios/ })).toHaveCount(0);
    await expect(page.getByText("€9.00").first()).toBeVisible();
    await page.reload();
    await expect(page.getByText("€9.00").first()).toBeVisible();
  });

  test("eliminar pedido (confirmando el diálogo nativo)", async ({ page }) => {
    await createOrderViaUI(page);
    await page.goto("/pedidos");
    page.once("dialog", (d) => d.accept());
    await page.locator("button:has(svg.lucide-trash2)").first().click();
    await expect(page.getByText("No hay pedidos en esta fecha")).toBeVisible();
    await page.reload();
    await expect(page.getByText("No hay pedidos en esta fecha")).toBeVisible();
  });

  test("rechazar el diálogo de borrado conserva el pedido", async ({ page }) => {
    await createOrderViaUI(page);
    await page.goto("/pedidos");
    page.once("dialog", (d) => d.dismiss());
    await page.locator("button:has(svg.lucide-trash2)").first().click();
    await expect(page.getByText("Pedido #1")).toBeVisible();
  });

  test("resumen del día refleja ventas", async ({ page }) => {
    await createOrderViaUI(page, { payment: "Tarjeta" });
    await page.goto("/pedidos");
    await page.getByRole("button", { name: "Ver Resumen del Día" }).click();
    await expect(page.getByRole("button", { name: "Ver Pedidos" })).toBeVisible();
    await expect(page.getByText("€4.50").first()).toBeVisible();
  });

  test("sin conexión se puede seguir creando pedidos", async ({ page, context }) => {
    await page.goto("/");
    await context.setOffline(true);
    await createOrderViaUIOffline(page);
    await context.setOffline(false);
    await page.goto("/pedidos");
    await expect(page.getByText("Pedido #1")).toBeVisible();
  });
});

async function createOrderViaUIOffline(page: import("@playwright/test").Page) {
  const card = page.locator("div.overflow-hidden", { hasText: "Paella Valenciana" }).first();
  await card.getByRole("button", { name: /Ración Completa/ }).click();
  await page.getByRole("button", { name: /Ver pedido/ }).click();
  await page.getByRole("button", { name: /Confirmar Pedido/ }).click();
  await expect(page.getByText(/Pedido guardado localmente/)).toBeVisible();
}
