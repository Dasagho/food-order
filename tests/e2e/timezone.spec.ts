import { test, expect } from "@playwright/test";
import { createOrderViaUI } from "./helpers";

// El negocio funciona siempre en hora de Madrid, aunque el dispositivo esté en otra zona.
for (const timezoneId of ["America/Los_Angeles", "Asia/Tokyo"]) {
  test.describe(`dispositivo en ${timezoneId}`, () => {
    test.use({ timezoneId });

    const madrid = (opts: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", ...opts }).format(new Date());

    test("el pedido de hoy aparece en 'hoy' y la fecha mostrada es la de Madrid", async ({ page }) => {
      await createOrderViaUI(page);
      await page.goto("/pedidos");
      await expect(page.getByText("Pedido #1")).toBeVisible();
      const label = madrid({ weekday: "short", day: "numeric", month: "short", year: "numeric" });
      await expect(page.getByRole("button", { name: label })).toBeVisible();

      await page.getByRole("button", { name: "Ver Resumen del Día" }).click();
      const long = madrid({ day: "numeric", month: "long", year: "numeric" });
      await expect(page.getByText(new RegExp(long))).toBeVisible();
    });
  });
}
