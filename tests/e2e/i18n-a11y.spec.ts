import { test, expect, login, idbDump, addDish, payButton, tile } from "./helpers";

test.describe("idioma: árabe de Egipto con RTL", () => {
  test("cambiar a árabe: lang/dir, interfaz traducida, cifras árabes, preferencia en IndexedDB (no en localStorage) y recarga", async ({ page }) => {
    await login(page);
    await page.getByRole("button", { name: "العربية — تغيير اللغة" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "ar-EG");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("navigation", { name: "الأقسام" }).getByRole("link", { name: "الكاشير" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("note")).toBeVisible(); // aviso: traducción pendiente de revisión nativa
    await expect(tile(page, "Paella Valenciana")).toContainText("٤٫٥٠");
    // RTL real: la cabecera nace a la derecha (la primera pestaña, «الكاشير», queda a la derecha de «المنيو»)
    const a = await page.getByRole("link", { name: "الكاشير" }).boundingBox();
    const b = await page.getByRole("link", { name: "المنيو" }).boundingBox();
    expect(a!.x).toBeGreaterThan(b!.x);

    const meta = await idbDump(page, "meta");
    expect(meta.find((m) => m.key === "lang")?.value).toBe("ar");
    const ls = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    expect(ls).not.toMatch(/od_lang|"ar"|lang/);

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("link", { name: "الكاشير" })).toBeVisible();

    // pantalla de cobro y Ventas en árabe
    await tile(page, "Paella Valenciana").getByRole("button").first().click();
    await page.locator("#ticket .btn.primary.big").click();
    await expect(page.getByRole("dialog")).toContainText("تحصيل");
    await page.keyboard.press("Escape");
    await page.getByRole("link", { name: "المبيعات" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "المبيعات" })).toBeVisible();

    await page.getByRole("button", { name: "Español — cambiar idioma" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "es");
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  });

  test("la pantalla de entrada también se puede poner en árabe", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "العربية — تغيير اللغة" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "دخول" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  });

  test("?lang=ar fuerza el árabe", async ({ page }) => {
    await page.goto("/?lang=ar");
    await expect(page.locator("html")).toHaveAttribute("lang", "ar-EG");
  });
});

test.describe("accesibilidad básica", () => {
  test("teclado: Tab llega a los platos, Enter los añade, el cobro es un <dialog> modal y Esc devuelve el foco", async ({ page }) => {
    await login(page);
    const btn = tile(page, "Paella Valenciana").getByRole("button", { name: /Cobrar Completa/ });
    await btn.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator("#ticket .total-row .big")).toContainText("4,50");
    await expect(page.locator(":focus-visible")).toBeVisible();
    const pay = payButton(page);
    await pay.focus();
    await page.keyboard.press("Enter");
    const dlg = page.getByRole("dialog", { name: "Cobrar" });
    await expect(dlg).toBeVisible();
    expect(await dlg.evaluate((d) => d.tagName + ":" + d.contains(document.activeElement))).toBe("DIALOG:true");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(pay).toBeFocused();
  });

  test("foco visible de 4 px, solo peso 400 y tamaños táctiles ≥ 56 px en los botones principales", async ({ page }) => {
    await login(page);
    await tile(page, "Paella Valenciana").getByRole("button", { name: /Cobrar Completa/ }).focus();
    await page.keyboard.press("Shift+Tab"); // con teclado se muestra :focus-visible
    await page.keyboard.press("Tab");
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement!).outlineWidth);
    expect(outline).toBe("4px");
    const weights = await page.evaluate(() => [...new Set([...document.querySelectorAll("body *")].map((e) => getComputedStyle(e).fontWeight))]);
    expect(weights).toEqual(["400"]);
    const h = await page.getByRole("link", { name: "Ventas" }).evaluate((e) => e.getBoundingClientRect().height);
    expect(h).toBeGreaterThanOrEqual(56);
  });

  test("móvil 390 px: sin scroll horizontal y barra inferior con el total y «Cobrar»", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page);
    await addDish(page, "Paella Valenciana");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const bar = page.locator(".mobile-bar");
    await expect(bar).toBeVisible();
    await expect(bar).toContainText("4,50");
    await bar.getByRole("button", { name: "Cobrar" }).click();
    await expect(page.getByRole("dialog", { name: "Cobrar" })).toBeVisible();
  });
});
