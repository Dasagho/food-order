import { test, expect, seedLegacyData, legacyOrder, server, idbDump } from "./helpers";

// Simula a la usuaria real: el navegador ya tiene datos del formato antiguo (localStorage) y abre
// la versión nueva. Al iniciar sesión se importan al servidor (SPEC §9.2) y se vacían en local.
test.describe("importación de datos del formato antiguo", () => {
  test("pedidos y catálogo antiguos se envían al servidor, aparecen intactos y se vacían los almacenes legacy", async ({ page }) => {
    await seedLegacyData(page, {
      orders: [
        legacyOrder(3, { id: "l3", status: "en_proceso", paymentMethod: "bizum", date: new Date(Date.now() - 1000).toISOString() }),
        legacyOrder(2, { id: "l2", status: "cancelado", date: new Date(Date.now() - 2000).toISOString() }),
        legacyOrder(1, { id: "l1", date: new Date(Date.now() - 3000).toISOString() }),
      ],
      products: [
        { id: "c1", name: "Plato del cliente", price: 6, image: "", category: "principales", portionType: "unidades", displayOrder: 0 },
      ],
      categories: [{ id: "principales", name: "Platos Principales", displayOrder: 1 }],
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Entrar sin Microsoft (desarrollo)" }).click();
    await expect(page.getByText(/Datos antiguos importados al servidor: 3 pedidos, 1 productos/)).toBeVisible();
    // el catálogo importado se ve en el menú (junto al del servidor)
    await expect(page.getByRole("heading", { name: "Plato del cliente" })).toBeVisible();

    const orders = await server.orders();
    expect(orders.map((o) => o.legacyNumber).sort()).toEqual([1, 2, 3]);
    await page.getByRole("link", { name: "Ventas" }).click();
    for (const n of [1, 2, 3]) await expect(page.locator(".srow").filter({ has: page.locator(".s-num", { hasText: new RegExp(`^nº\\s*${n}$`) }) })).toBeVisible();
    await expect(page.locator(".chip.en_proceso")).toBeVisible();
    await expect(page.locator(".srow")).toHaveCount(3);

    // IndexedDB legacy vacío; localStorage SIN tocar
    for (const store of ["orders", "products", "categories"]) expect(await idbDump(page, store)).toEqual([]);
    const meta = await idbDump(page, "meta");
    expect(meta.some((m) => m.key === "legacy_import_done")).toBe(true);
    const ls = await page.evaluate(() => ({
      orders: JSON.parse(localStorage.getItem("confirmed_orders")!).length,
      products: JSON.parse(localStorage.getItem("menu_products")!).length,
    }));
    expect(ls).toEqual({ orders: 3, products: 1 });
  });

  test("el catálogo de la tablet MANDA: sobrescribe por id lo que el servidor ya tenga y conserva lo que solo está en el servidor", async ({ page }) => {
    await seedLegacyData(page, {
      products: [
        { id: "1", name: "Paella de la tablet", price: 6, image: "/paella-valenciana.jpg", category: "arroces", portionType: "racion", halfPortionPrice: 4, displayOrder: 0 },
      ],
      categories: [{ id: "arroces", name: "Arroces y Paellas", displayOrder: 1 }],
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Entrar sin Microsoft (desarrollo)" }).click();
    await expect(page.getByRole("heading", { name: "Paella de la tablet" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Paella Valenciana", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Lata de refresco" })).toBeVisible(); // solo estaba en el servidor
    const products = (await server.catalog()).products;
    expect(products.find((p) => p.id === "1")).toMatchObject({ name: "Paella de la tablet", price: 6 });
    expect(products.map((p) => p.id).sort()).toEqual(["1", "2", "3", "4"]);
    expect(await idbDump(page, "products")).toEqual([]);
  });

  test("la numeración del servidor es por día y el número antiguo queda en legacyNumber", async ({ page }) => {
    await seedLegacyData(page, { orders: [legacyOrder(57, { id: "l57" })] });
    await page.goto("/");
    await page.getByRole("button", { name: "Entrar sin Microsoft (desarrollo)" }).click();
    await expect.poll(async () => (await server.orders()).length).toBe(1);
    const [o] = await server.orders();
    expect(o).toMatchObject({ number: 1, legacyNumber: 57 });
  });

  test("datos corruptos en localStorage no dejan la app en blanco", async ({ page }) => {
    await page.addInitScript(() => {
      if (sessionStorage.getItem("__s")) return;
      sessionStorage.setItem("__s", "1");
      localStorage.setItem("confirmed_orders", "{esto no es json");
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Entrar sin Microsoft (desarrollo)" }).click();
    await expect(page.getByRole("heading", { name: "Paella Valenciana" })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("confirmed_orders"))).toBe("{esto no es json");
  });
});
