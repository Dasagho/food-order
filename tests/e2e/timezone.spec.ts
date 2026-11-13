import { test, expect, login, createOrderViaUI } from "./helpers";

// El negocio funciona siempre en hora de Madrid, aunque el dispositivo esté en otra zona.
for (const timezoneId of ["America/Los_Angeles", "Asia/Tokyo"]) {
  test.describe(`dispositivo en ${timezoneId}`, () => {
    test.use({ timezoneId });

    const madrid = (opts: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", ...opts }).format(new Date());

    test("el pedido de hoy aparece en 'hoy' y la fecha mostrada es la de Madrid", async ({ page }) => {
      await login(page);
      await createOrderViaUI(page);
      await page.goto("/ventas");
      await expect(page.locator(".srow", { hasText: "nº 1" })).toBeVisible();
      const label = madrid({ weekday: "short", day: "numeric", month: "short" });
      await expect(page.getByLabel("Otro día:")).toHaveValue(/\d{4}-\d{2}-\d{2}/);
      await expect(page.locator("#dpick option:checked")).toContainText(label.replace(".", ""));
      // la hora mostrada es la de Madrid
      const hhmm = madrid({ hour: "2-digit", minute: "2-digit" });
      await expect(page.locator(".srow", { hasText: "nº 1" })).toContainText(hhmm.slice(0, 2));
    });
  });
}
