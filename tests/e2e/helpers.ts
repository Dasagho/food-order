import { test as base, expect, type Page } from "@playwright/test";

/** E2E_BACKEND=real: los tests corren contra food-order-api (vía tests/real-api/control.mjs) en vez del fake. */
export const REAL = process.env.E2E_BACKEND === "real";

export const API = `http://localhost:${process.env.E2E_API_PORT ?? 4174}`;

/** Control del backend falso (tests/fake-api/server.ts). */
export const server = {
  async call(path: string, body?: unknown) {
    const res = await fetch(`${API}${path}`, {
      method: body === undefined && path === "/__orders" ? "GET" : "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return res.json();
  },
  reset: () => server.call("/__reset", {}),
  /** true: el backend contesta 503 a todo (caído) */
  down: (down: boolean) => server.call("/__down", { down }),
  expireTokens: () => server.call("/__expire", {}),
  orders: () => server.call("/__orders") as Promise<any[]>,
  catalog: () => fetch(`${API}/__catalog`).then((r) => r.json()) as Promise<{ products: any[]; categories: any[] }>,
  code: (challenge: string) => server.call("/__code", { challenge }) as Promise<{ code: string }>,
};

/** Cada test parte de un backend limpio (y de un navegador limpio: contexto nuevo). */
export const test = base.extend({
  page: async ({ page }, use) => {
    await server.reset();
    await use(page);
  },
});
export { expect };

/** Inicia sesión con el acceso de desarrollo (VITE_DEV_LOGIN=1) y espera a la Caja con el menú. */
export async function login(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Entrar sin Microsoft (desarrollo)" }).click();
  await expect(page.getByRole("heading", { name: "Paella Valenciana" })).toBeVisible();
}

/** Ficha de un plato en la Caja. */
export const tile = (page: Page, dish: string) =>
  page.getByRole("heading", { name: dish, exact: true }).locator("xpath=ancestor::li[1]");

/** Panel del ticket (columna derecha en escritorio). */
export const ticket = (page: Page) => page.locator("#ticket");

/** Botón «Cobrar …» del ticket. */
export const payButton = (page: Page) => ticket(page).getByRole("button", { name: /^Cobrar/ });

/** Añade un plato (ración completa / unidad) al ticket de la Caja. */
export async function addDish(page: Page, dish: string, which: RegExp = /Cobrar (Completa|Ración|Añadir)/) {
  await tile(page, dish).getByRole("button", { name: which }).click();
}

/** Crea un pedido de un plato (ración completa) por la UI, ya con la sesión iniciada. */
export async function createOrderViaUI(
  page: Page,
  opts: { payment?: "Efectivo" | "Tarjeta" | "Bizum"; dish?: string; inProcess?: boolean } = {},
) {
  await page.goto("/");
  await addDish(page, opts.dish ?? "Paella Valenciana");
  await payButton(page).click();
  const dlg = page.getByRole("dialog");
  if (opts.payment) await dlg.getByRole("button", { name: opts.payment, exact: true }).click();
  if (opts.inProcess) await dlg.getByRole("switch", { name: "Dejar en proceso" }).click();
  await dlg.getByRole("button", { name: opts.inProcess ? "Guardar en proceso" : "Confirmar" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: /Venta|Pedido .* en proceso/ })).toBeVisible();
}

/** Cliente directo de la API (como otro dispositivo): sirve contra el fake y contra el backend real. */
export async function apiCall(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const login = await fetch(`${API}/v1/auth/dev-login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const { accessToken } = (await login.json()) as { accessToken: string };
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : undefined, headers: res.headers };
}

/** Crea un pedido por la API (otro dispositivo). */
export const apiOrder = (over: Record<string, unknown> = {}) =>
  apiCall("POST", "/v1/orders", {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    paymentMethod: "efectivo",
    items: [{ productId: "1", name: "Paella Valenciana", unitPrice: 4.5, listPrice: 4.5, quantity: 1, half: false }],
    ...over,
  });

/** Fila de una venta en la pantalla Ventas. */
export const saleRow = (page: Page, n: number) => page.locator(".srow").filter({ has: page.locator(".s-num", { hasText: new RegExp(`^nº\\s*${n}$`) }) });

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

/** Lee un almacén de la IndexedDB `food-order` desde el navegador. */
export async function idbDump(page: Page, store: string): Promise<any[]> {
  return page.evaluate(
    (name) =>
      new Promise<any[]>((resolve, reject) => {
        const open = indexedDB.open("food-order");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains(name)) return resolve([]);
          const req = db.transaction(name).objectStore(name).getAll();
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        };
      }),
    store,
  );
}
