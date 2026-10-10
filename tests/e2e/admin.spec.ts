import { test, expect } from "@playwright/test";

test.describe("admin: gestión del menú", () => {
  test("muestra productos por defecto y filtra por categoría", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Paella Valenciana" })).toBeVisible();
    await page.getByRole("button", { name: "Bebidas", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Paella Valenciana" })).toHaveCount(0);
  });

  test("crear producto: aparece en admin y en el menú tras recargar", async ({ page }) => {
    await page.goto("/admin");
    await page.getByRole("button", { name: /Nuevo Producto/ }).click();
    await page.locator("#name").fill("Tortilla de prueba");
    await page.locator("#price").fill("3.25");
    await page.locator("#image").fill("/placeholder.svg");
    await page.getByRole("button", { name: /Crear Producto/ }).click();
    await expect(page.getByRole("heading", { name: "Tortilla de prueba" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Tortilla de prueba" })).toBeVisible();
    await page.goto("/");
    await expect(page.getByText("Tortilla de prueba")).toBeVisible();
    await expect(page.getByText("€3.25")).toBeVisible();
  });

  test("editar producto cambia nombre y precio", async ({ page }) => {
    await page.goto("/admin");
    const card = page.locator("div.rounded-xl", { hasText: "Paella Valenciana" }).first();
    await card.getByRole("button", { name: /Editar/ }).click();
    await page.locator("#name").fill("Paella Premium");
    await page.locator("#price").fill("7");
    await page.getByRole("button", { name: /Actualizar Producto/ }).click();
    await expect(page.getByRole("heading", { name: "Paella Premium" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Paella Premium" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Paella Valenciana" })).toHaveCount(0);
  });

  test("eliminar producto (confirmando)", async ({ page }) => {
    await page.goto("/admin");
    page.once("dialog", (d) => d.accept());
    const card = page.locator("div.rounded-xl", { hasText: "Paella Valenciana" }).first();
    await card.locator("button:has(svg.lucide-trash2)").click();
    await expect(page.getByRole("heading", { name: "Paella Valenciana" })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Paella Valenciana" })).toHaveCount(0);
    await page.goto("/");
    await expect(page.getByText("Paella Valenciana")).toHaveCount(0);
  });

  test("reordenar arrastrando persiste el orden en admin y en el menú", async ({ page }) => {
    await page.goto("/admin");
    await page.getByRole("button", { name: "Reordenar" }).click();
    const handles = page.locator("[aria-roledescription='sortable']");
    const a = (await handles.nth(0).boundingBox())!;
    const b = (await handles.nth(1).boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 20, a.y + a.height / 2, { steps: 5 });
    await page.mouse.move(b.x + b.width / 2 + 40, b.y + b.height / 2, { steps: 15 });
    await page.mouse.up();
    const titles = () => page.locator("h3").allTextContents();
    await expect.poll(async () => (await titles()).slice(0, 2)).toEqual(["Arroz de marisco", "Paella Valenciana"]);
    await page.reload();
    await page.getByRole("button", { name: "Reordenar" }).click();
    expect((await titles()).slice(0, 2)).toEqual(["Arroz de marisco", "Paella Valenciana"]);
    await page.goto("/");
    const names = await page.locator("h3").allTextContents();
    expect(names.indexOf("Arroz de marisco")).toBeLessThan(names.indexOf("Paella Valenciana"));
  });
});
