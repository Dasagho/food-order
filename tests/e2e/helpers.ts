import { test as base, expect, type Page } from "@playwright/test";
import { deflateSync, crc32 } from "node:zlib";

/** E2E_BACKEND=real: los tests corren contra food-order-api (vía tests/real-api/control.mjs) en vez del fake. */
export const REAL = process.env.E2E_BACKEND === "real";

export const API = `http://localhost:${process.env.E2E_API_PORT ?? 4174}`;
/** Origen de la app (vite preview). Las imágenes /media/<clave> se piden SIEMPRE a este origen, nunca al de la API. */
export const APP = `http://localhost:${process.env.E2E_PORT ?? 4173}`;

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

/**
 * PNG válido (RGB, 1000 de ancho) de aproximadamente `bytes` bytes. Va con deflate «stored» (nivel 0): el fichero
 * pesa lo mismo que los píxeles, así se controla el tamaño sin depender de la compresión.
 */
export function bigPng(bytes: number): Buffer {
  const width = 1000;
  const height = Math.ceil(bytes / (width * 3));
  const raw = Buffer.alloc((width * 3 + 1) * height); // filtro «None» (0) en cada fila; píxeles negros
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8 bits, RGB
  // nivel 0 (sin compresión): el PNG pesa lo mismo que los píxeles, así se controla el tamaño del fichero
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 0 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** PNG de 1x1 píxel válido (rojo). */
export const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);

/** Sube una imagen por la API (multipart, como otro dispositivo) y devuelve {url, key}. */
export async function apiUpload(file: Buffer, name = "foto.png", type = "image/png") {
  const login = await fetch(`${API}/v1/auth/dev-login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  const { accessToken } = (await login.json()) as { accessToken: string };
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(file)], { type }), name);
  const res = await fetch(`${API}/v1/uploads`, { method: "POST", headers: { authorization: `Bearer ${accessToken}` }, body: form });
  return { status: res.status, body: (await res.json()) as { url: string; key: string } };
}

/** ¿La imagen terminó de cargar y tiene píxeles? */
export const imgLoaded = (loc: ReturnType<Page["locator"]>) =>
  loc.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0);
