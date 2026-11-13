import { test, expect } from "@playwright/test";
import { seedLegacyData, legacyOrder, createOrderViaUI } from "./helpers";

// Simula a la usuaria real: el navegador ya tiene datos del formato antiguo (localStorage)
// y abre la versión nueva. Debe verlo TODO igual, sin hacer nada.
test.describe("datos existentes del formato antiguo", () => {
  test("pedidos antiguos aparecen intactos, con totales y estados", async ({ page }) => {
    await seedLegacyData(page, {
      orders: [
        legacyOrder(3, { id: "l3", status: "en_proceso", paymentMethod: "bizum" }),
        legacyOrder(2, { id: "l2", status: "cancelado" }),
        legacyOrder(1, { id: "l1" }),
      ],
    });
    await page.goto("/pedidos");
    for (const n of [1, 2, 3]) await expect(page.getByText(`Pedido #${n}`)).toBeVisible();
    await expect(page.getByText("En Proceso")).toBeVisible();
    await expect(page.getByText(/3\s+pedidos/)).toBeVisible();
    await expect(page.getByText("€9.00").first()).toBeVisible();
  });

  test("la numeración continúa tras los pedidos antiguos", async ({ page }) => {
    await seedLegacyData(page, { orders: [legacyOrder(57, { id: "l57" })] });
    await createOrderViaUI(page);
    await page.goto("/pedidos");
    await expect(page.getByText("Pedido #58")).toBeVisible();
    await expect(page.getByText("Pedido #57")).toBeVisible();
  });

  test("menú personalizado antiguo se conserva (no se resiembran los defaults)", async ({ page }) => {
    await seedLegacyData(page, {
      products: [
        { id: "c1", name: "Plato del cliente", price: 6, image: "", category: "principales", portionType: "unidades", displayOrder: 0 },
      ],
    });
    await page.goto("/");
    await expect(page.getByText("Plato del cliente")).toBeVisible();
    await expect(page.getByText("Paella Valenciana")).toHaveCount(0);
  });

  test("se puede seguir operando sobre datos antiguos y persiste tras recarga", async ({ page }) => {
    await seedLegacyData(page, { orders: [legacyOrder(1, { id: "l1" })] });
    await page.goto("/pedidos");
    page.once("dialog", (d) => d.accept());
    await page.locator("button:has(svg.lucide-trash2)").first().click();
    await expect(page.getByText("No hay pedidos en esta fecha")).toBeVisible();
    await page.reload(); // el seed no se repite (flag en sessionStorage)
    await expect(page.getByText("No hay pedidos en esta fecha")).toBeVisible();
  });

  test("datos corruptos en localStorage no dejan la app en blanco", async ({ page }) => {
    await page.addInitScript(() => {
      if (sessionStorage.getItem("__s")) return;
      sessionStorage.setItem("__s", "1");
      localStorage.setItem("confirmed_orders", "{esto no es json");
    });
    await page.goto("/");
    await expect(page.getByText("Paella Valenciana")).toBeVisible();
  });
});
