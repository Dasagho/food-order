/**
 * Importación única de los datos de la versión anterior (SPEC §9.2).
 *
 * Primer arranque autenticado con datos legacy:
 *  1. Si aún quedan datos en localStorage de una versión anterior, se copian (sin tocar
 *     localStorage, solo lectura) a los almacenes legacy de IndexedDB con el mecanismo
 *     de migración de la PR (transacción atómica + marca en `meta`).
 *  2. Se envían al servidor: primero el catálogo y luego los pedidos (en tandas, por fecha).
 *  3. SOLO lo que el servidor confirma se borra de IndexedDB. Si algo falla se conserva
 *     todo lo no confirmado y se reintenta en el siguiente arranque. Al terminar queda
 *     `meta.legacy_import_done`, que impide repetirla.
 */
import { api } from "@/lib/api";
import { getDb, getMeta, req, run, setMeta, txDone, withLock } from "@/lib/db";
import { roundMoney } from "@/lib/mapping";

export const LS_ORDERS = "confirmed_orders";
export const LS_PRODUCTS = "menu_products";
export const LS_CATEGORIES = "menu_categories";

const MIGRATED_KEY = "migrated_from_localstorage_v1";
const SEEDED_PRODUCTS = "seeded_products";
const SEEDED_CATEGORIES = "seeded_categories";
export const LEGACY_DONE_KEY = "legacy_import_done";

const BATCH = 200;

/** Lee un array JSON de localStorage (solo lectura). null si no existe o está corrupto. */
export function readLegacyArray<T = any>(key: string): T[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch (e) {
    console.error(`[legacy] No se pudo leer "${key}" de localStorage`, e);
    return null;
  }
}

/**
 * Mecanismo de migración localStorage → IndexedDB de la versión anterior: una
 * transacción atómica que copia sin borrar y deja la marca en `meta`.
 */
async function migrateFromLocalStorage(): Promise<void> {
  const db = await getDb();
  if (await getMeta(MIGRATED_KEY)) return;

  const orders = readLegacyArray<any>(LS_ORDERS);
  const products = readLegacyArray<any>(LS_PRODUCTS);
  const categories = readLegacyArray<any>(LS_CATEGORIES);

  const tx = db.transaction(["orders", "products", "categories", "meta"], "readwrite");
  const done = txDone(tx);
  const valid = (x: any) => x && typeof x === "object" && x.id != null;

  const validOrders = (orders ?? []).filter(valid);
  // localStorage guardaba "más reciente primero": el índice 0 recibe la posición más alta
  validOrders.forEach((o, i) =>
    tx.objectStore("orders").put({ ...o, date: new Date(o.date), _pos: validOrders.length - i }),
  );
  const validProducts = (products ?? []).filter(valid);
  validProducts.forEach((p, i) => tx.objectStore("products").put({ ...p, _pos: i + 1 }));
  const validCategories = (categories ?? []).filter(valid);
  validCategories.forEach((c, i) => tx.objectStore("categories").put({ ...c, _pos: i + 1 }));

  tx.objectStore("meta").put({
    key: MIGRATED_KEY,
    value: {
      at: new Date().toISOString(),
      orders: validOrders.length,
      products: validProducts.length,
      categories: validCategories.length,
    },
  });
  await done;
}

const stripPos = ({ _pos, ...rest }: any) => rest;

export interface LegacyData {
  orders: any[];
  products: any[];
  categories: any[];
}

export async function readLegacyData(): Promise<LegacyData> {
  return run(["orders", "products", "categories"], "readonly", async (tx) => {
    const [orders, products, categories] = await Promise.all([
      req(tx.objectStore("orders").getAll()),
      req(tx.objectStore("products").index("pos").getAll()),
      req(tx.objectStore("categories").index("pos").getAll()),
    ]);
    return { orders, products: products.map(stripPos), categories: categories.map(stripPos) };
  });
}

/** Formato de pedido que espera POST /import/orders (el del cliente antiguo). */
function toImportOrder(o: any) {
  const d = o.date instanceof Date ? o.date : new Date(o.date);
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    items: (o.items ?? []).map((i: any) => ({
      id: i.id,
      name: i.name,
      price: roundMoney(i.price), // el servidor rechaza más de 2 decimales (invalid_amount)
      quantity: i.quantity,
      isHalfPortion: !!i.isHalfPortion,
      ...(i.halfPortionPrice !== undefined ? { halfPortionPrice: i.halfPortionPrice } : {}),
    })),
    total: o.total,
    date: Number.isNaN(d.getTime()) ? String(o.date) : d.toISOString(),
    status: o.status,
    paymentMethod: o.paymentMethod ?? "efectivo",
  };
}

/** Formatos de catálogo que espera POST /import/catalog (SPEC §6.5): imagen obligatoria, importes ≤ 2 decimales. */
const toImportProduct = (p: any) => ({
  ...p,
  image: typeof p.image === "string" && p.image.trim() ? p.image : "/placeholder.svg",
  price: roundMoney(p.price),
  ...(typeof p.halfPortionPrice === "number" ? { halfPortionPrice: roundMoney(p.halfPortionPrice) } : {}),
});

const deleteByIds = (store: "orders" | "products" | "categories", ids: string[]) =>
  run(store, "readwrite", async (tx) => {
    ids.forEach((id) => tx.objectStore(store).delete(id));
  });

export type LegacyImportResult =
  | { status: "skipped" }
  | { status: "nothing" }
  | { status: "done"; orders: number; products: number; categories: number; skipped: number }
  | { status: "partial"; remaining: number }
  | { status: "failed"; error: unknown };

/** Ejecuta la importación (idempotente y segura de repetir). Requiere sesión iniciada. */
export function importLegacyData(): Promise<LegacyImportResult> {
  return withLock("food-order-legacy-import", async (): Promise<LegacyImportResult> => {
    if (await getMeta(LEGACY_DONE_KEY)) return { status: "skipped" };
    try {
      await migrateFromLocalStorage();
      const data = await readLegacyData();
      const counts = { orders: 0, products: data.products.length, categories: data.categories.length, skipped: 0 };

      let remaining = 0;
      if (data.products.length || data.categories.length) {
        const res = await api.import.catalog(data.categories, data.products.map(toImportProduct));
        // POST /import/catalog responde 200 aunque rechace elementos sueltos ({errors:[{id,reason}]}):
        // solo se borra de IndexedDB lo que el servidor ha confirmado.
        const failed = new Set((res.errors ?? []).map((e) => e.id));
        await deleteByIds("categories", data.categories.map((c) => c.id).filter((id) => !failed.has(id)));
        await deleteByIds("products", data.products.map((p) => p.id).filter((id) => !failed.has(id)));
        remaining += failed.size;
        if (failed.size) console.error("[legacy] catálogo rechazado por el servidor", res.errors);
      }

      const sorted = [...data.orders].sort(
        (a, b) =>
          new Date(a.date).getTime() - new Date(b.date).getTime() || (a.orderNumber ?? 0) - (b.orderNumber ?? 0),
      );
      for (let i = 0; i < sorted.length; i += BATCH) {
        const batch = sorted.slice(i, i + BATCH);
        const res = await api.import.orders(batch.map(toImportOrder));
        const failed = new Set((res.errors ?? []).map((e) => e.id));
        counts.orders += res.created ?? 0;
        counts.skipped += res.skipped ?? 0;
        await deleteByIds("orders", batch.map((o) => o.id).filter((id) => !failed.has(id)));
        remaining += failed.size;
        if (failed.size) console.error("[legacy] pedidos rechazados por el servidor", res.errors);
      }
      if (remaining > 0) return { status: "partial", remaining };

      await run("meta", "readwrite", async (tx) => {
        const meta = tx.objectStore("meta");
        meta.delete(SEEDED_PRODUCTS);
        meta.delete(SEEDED_CATEGORIES);
        meta.put({
          key: LEGACY_DONE_KEY,
          value: { at: new Date().toISOString(), ...counts },
        });
      });
      const nothing = !data.orders.length && !data.products.length && !data.categories.length;
      return nothing ? { status: "nothing" } : { status: "done", ...counts };
    } catch (error) {
      console.error("[legacy] la importación falló; se conserva todo y se reintentará", error);
      return { status: "failed", error };
    }
  });
}
