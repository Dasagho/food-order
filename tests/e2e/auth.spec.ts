import { test, expect, server, idbDump, login, REAL } from "./helpers";

test.describe("autenticación (SPEC §4)", () => {
  test("sin sesión solo se ve la pantalla de iniciar sesión", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /Entrar con Microsoft/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Paella Valenciana" })).toHaveCount(0);
    await page.goto("/ventas");
    await expect(page.getByRole("button", { name: /Entrar con Microsoft/ })).toBeVisible();
  });

  test("acceso de desarrollo: tokens SOLO en IndexedDB (almacén auth), nada en Web Storage", async ({ page }) => {
    await login(page);
    const [session] = await idbDump(page, "auth");
    expect(session.key).toBe("session");
    expect(session.value.accessToken).toMatch(REAL ? /^eyJ/ : /^acc-/); // JWT real / token del fake
    const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    expect(storage).not.toMatch(/acc-|ref-|eyJ|accessToken|refreshToken/);
    // la sesión sobrevive a una recarga
    await page.reload();
    await expect(page.getByRole("heading", { name: "Paella Valenciana" })).toBeVisible();
    
  });

  test("login con Microsoft: PKCE, redirección al backend, #code= y /auth/exchange", async ({ page }) => {
    // El backend real habla con Microsoft de verdad: ese tramo no se puede simular (lo cubren los tests del backend)
    test.skip(REAL, "requiere /__code del fake (callback de Microsoft simulado)");
    let loginUrl: URL | undefined;
    // El backend real redirigiría a Microsoft y volvería con un código; aquí se simula el callback
    await page.route("**/v1/auth/microsoft/login**", async (route) => {
      loginUrl = new URL(route.request().url());
      const { code } = await server.code(loginUrl.searchParams.get("challenge")!);
      await route.fulfill({
        status: 302,
        headers: { location: `${loginUrl.searchParams.get("redirect")}#code=${code}` },
      });
    });
    await page.goto("/");
    await page.getByRole("button", { name: /Entrar con Microsoft/ }).click();
    await expect(page.getByRole("heading", { name: "Paella Valenciana" })).toBeVisible();
    expect(loginUrl!.searchParams.get("challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(loginUrl!.searchParams.get("redirect")).toBe("http://localhost:4173/");
    expect(page.url()).not.toContain("code="); // el código no se queda en la barra de direcciones
    expect((await idbDump(page, "auth")).some((r) => r.key === "session")).toBe(true);
    expect((await idbDump(page, "auth")).some((r) => r.key === "pkce")).toBe(false); // verifier consumido
  });

  test("acceso denegado (#error=access_denied) muestra el aviso en la pantalla de entrada", async ({ page }) => {
    await page.goto("/#error=access_denied");
    await expect(page.getByRole("alert")).toHaveText("Esa cuenta no tiene permiso para entrar.");
    await expect(page.getByRole("heading", { name: "Paella Valenciana" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Entrar con Microsoft/ })).toBeVisible();
  });

  test("cerrar sesión vuelve a la pantalla de login y revoca el refresh token", async ({ page }) => {
    await login(page);
    await page.getByRole("link", { name: "Menú" }).click();
    await page.getByRole("button", { name: "Salir" }).click();
    await expect(page.getByRole("button", { name: /Entrar con Microsoft/ })).toBeVisible();
    expect((await idbDump(page, "auth")).some((r) => r.key === "session")).toBe(false);
  });
});
