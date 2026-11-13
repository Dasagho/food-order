import { expect, type Page } from "@playwright/test";

/** Crea un pedido de un plato (ración completa del primer plato de la lista) por la UI. */
export async function createOrderViaUI(
  page: Page,
  opts: { payment?: "Efectivo" | "Tarjeta" | "Bizum"; dish?: string } = {},
) {
  await page.goto("/");
  const dish = opts.dish ?? "Paella Valenciana";
  const card = page.locator("div.overflow-hidden", { hasText: dish }).first();
  await card.getByRole("button", { name: /Ración Completa/ }).click();
  await page.getByRole("button", { name: /Ver pedido/ }).click();
  if (opts.payment) await page.getByRole("button", { name: opts.payment, exact: true }).click();
  await page.getByRole("button", { name: /Confirmar Pedido/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

/** Datos en el formato exacto de la versión antigua (localStorage). Se siembran ANTES de cargar la app. */
export async function seedLegacyData(
  page: Page,
  data: { orders?: unknown[]; products?: unknown[]; categories?: unknown[] },
) {
  await page.addInitScript((d) => {
    if (sessionStorage.getItem("__seeded")) return;
    sessionStorage.setItem("__seeded", "1");
    if (d.orders) localStorage.setItem("confirmed_orders", JSON.stringify(d.orders));
    if (d.products) localStorage.setItem("menu_products", JSON.stringify(d.products));
    if (d.categories) localStorage.setItem("menu_categories", JSON.stringify(d.categories));
  }, data);
}

export function legacyOrder(n: number, over: Record<string, unknown> = {}) {
  const price = 4.5;
  return {
    id: `legacy-${n}`,
    orderNumber: n,
    items: [
      {
        id: "1",
        name: "Paella Valenciana",
        price,
        image: "/paella-valenciana.jpg",
        quantity: 2,
        category: "arroces",
        portionType: "racion",
        halfPortionPrice: 3,
        isHalfPortion: false,
      },
    ],
    total: price * 2,
    date: new Date().toISOString(),
    status: "completado",
    paymentMethod: "efectivo",
    ...over,
  };
}
