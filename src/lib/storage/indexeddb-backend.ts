import type { Category, ConfirmedOrder, MenuItem } from "@/types/order";
import type { Backend } from "./types";
import {
  LS_CATEGORIES,
  LS_ORDERS,
  LS_PRODUCTS,
  readLegacyArray,
} from "./legacy-keys";

const DB_NAME = "food-order";
const DB_VERSION = 1;

const MIGRATED_KEY = "migrated_from_localstorage_v1";
const SEEDED_PRODUCTS = "seeded_products";
const SEEDED_CATEGORIES = "seeded_categories";

type Stored<T> = T & { _pos: number };

// ───────────── helpers IndexedDB (promesas sobre la API de eventos) ─────────────
const req = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });

const txDone = (tx: IDBTransaction): Promise<void> =>
  new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error ?? new Error("transacción abortada"));
  });

/** Mayor valor de un índice numérico (0 si está vacío). */
async function maxKey(store: IDBObjectStore, index: string): Promise<number> {
  const cursor = await req(store.index(index).openKeyCursor(null, "prev"));
  return cursor ? (cursor.key as number) : 0;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      const orders = db.createObjectStore("orders", { keyPath: "id" });
      orders.createIndex("seq", "_pos");
      orders.createIndex("orderNumber", "orderNumber");
      db.createObjectStore("products", { keyPath: "id" }).createIndex(
        "pos",
        "_pos",
      );
      db.createObjectStore("categories", { keyPath: "id" }).createIndex(
        "pos",
        "_pos",
      );
      db.createObjectStore("meta", { keyPath: "key" });
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error("apertura de IndexedDB bloqueada"));
  });
}

const strip = <T>(r: Stored<T>): T => {
  const { _pos, ...rest } = r as any;
  return rest as T;
};

// ───────────── migración desde localStorage ─────────────
/**
 * Copia (sin borrar) los datos de localStorage a IndexedDB en UNA transacción
 * atómica. El flag de "migrado" se escribe en esa misma transacción, así que
 * o queda todo copiado o no queda nada (y se reintenta en el siguiente arranque).
 * localStorage se conserva intacto como respaldo.
 */
async function migrateFromLocalStorage(db: IDBDatabase): Promise<void> {
  const flagTx = db.transaction("meta", "readonly");
  const flag = await req(flagTx.objectStore("meta").get(MIGRATED_KEY));
  if (flag) return;

  const orders = readLegacyArray<any>(LS_ORDERS);
  const products = readLegacyArray<any>(LS_PRODUCTS);
  const categories = readLegacyArray<any>(LS_CATEGORIES);

  const tx = db.transaction(
    ["orders", "products", "categories", "meta"],
    "readwrite",
  );
  const done = txDone(tx);
  const valid = (x: any) => x && typeof x === "object" && x.id != null;

  const oStore = tx.objectStore("orders");
  const validOrders = (orders ?? []).filter(valid);
  // localStorage guardaba "más reciente primero": el índice 0 recibe la posición más alta
  validOrders.forEach((o, i) =>
    oStore.put({ ...o, date: new Date(o.date), _pos: validOrders.length - i }),
  );

  const pStore = tx.objectStore("products");
  const validProducts = (products ?? []).filter(valid);
  validProducts.forEach((p, i) => pStore.put({ ...p, _pos: i + 1 }));

  const cStore = tx.objectStore("categories");
  const validCategories = (categories ?? []).filter(valid);
  validCategories.forEach((c, i) => cStore.put({ ...c, _pos: i + 1 }));

  const meta = tx.objectStore("meta");
  // Si ya existía menú/categorías en localStorage, NO se vuelven a sembrar los de por defecto
  if (products !== null) meta.put({ key: SEEDED_PRODUCTS, value: true });
  if (categories !== null) meta.put({ key: SEEDED_CATEGORIES, value: true });
  meta.put({
    key: MIGRATED_KEY,
    value: {
      at: new Date().toISOString(),
      orders: validOrders.length,
      products: validProducts.length,
      categories: validCategories.length,
    },
  });
  await done;

  // Verificación posterior (solo informativa: localStorage sigue intacto)
  const check = db.transaction(["orders", "products", "categories"]);
  const [o, p, c] = await Promise.all([
    req(check.objectStore("orders").count()),
    req(check.objectStore("products").count()),
    req(check.objectStore("categories").count()),
  ]);
  if (
    o < validOrders.length ||
    p < validProducts.length ||
    c < validCategories.length
  ) {
    console.error("[storage] La verificación de la migración no coincide", {
      o,
      p,
      c,
    });
  }
}

// ───────────── backend ─────────────
export async function createIndexedDbBackend(): Promise<Backend> {
  const db = await openDb();
  // Si otra pestaña pide actualizar el esquema, liberamos la conexión
  db.onversionchange = () => db.close();

  const run = <T>(
    stores: string | string[],
    mode: IDBTransactionMode,
    fn: (tx: IDBTransaction) => Promise<T>,
  ): Promise<T> => {
    const tx = db.transaction(stores, mode);
    const finished = txDone(tx);
    return fn(tx).then(
      async (v) => (await finished, v),
      (e) => {
        try {
          tx.abort();
        } catch {}
        finished.catch(() => {});
        throw e;
      },
    );
  };

  // Migrar con exclusión mutua entre pestañas
  const locks = (navigator as any).locks;
  if (locks?.request) {
    await locks.request("food-order-migration", () =>
      migrateFromLocalStorage(db),
    );
  } else {
    await migrateFromLocalStorage(db);
  }

  // Listas con orden significativo (productos, categorías)
  const listStore = <T extends { id: string }>(name: "products" | "categories") => ({
    list: () =>
      run(name, "readonly", async (tx) =>
        (
          (await req(
            tx.objectStore(name).index("pos").getAll(),
          )) as Stored<T>[]
        ).map(strip),
      ),
    upsert: (item: T) =>
      run(name, "readwrite", async (tx) => {
        const store = tx.objectStore(name);
        const existing = (await req(store.get(item.id))) as Stored<T> | undefined;
        const pos = existing?._pos ?? (await maxKey(store, "pos")) + 1;
        store.put({ ...item, _pos: pos });
      }),
    remove: (id: string) =>
      run(name, "readwrite", async (tx) => {
        tx.objectStore(name).delete(id);
      }),
    replaceAll: (items: T[]) =>
      run(name, "readwrite", async (tx) => {
        const store = tx.objectStore(name);
        store.clear();
        items.forEach((it, i) => store.put({ ...it, _pos: i + 1 }));
      }),
  });
  const products = listStore<MenuItem>("products");
  const categories = listStore<Category>("categories");

  return {
    kind: "indexeddb",

    listOrders: () =>
      run("orders", "readonly", async (tx) => {
        const rows = (await req(
          tx.objectStore("orders").index("seq").getAll(),
        )) as Stored<ConfirmedOrder>[];
        return rows.reverse().map((r) => ({ ...strip(r), date: new Date(r.date) }));
      }),

    addOrder: (order) =>
      run("orders", "readwrite", async (tx) => {
        const store = tx.objectStore("orders");
        const seq = (await maxKey(store, "seq")) + 1;
        store.put({ ...order, _pos: seq });
      }),

    removeOrder: (id) =>
      run("orders", "readwrite", async (tx) => {
        tx.objectStore("orders").delete(id);
      }),

    patchOrder: (id, patch) =>
      run("orders", "readwrite", async (tx) => {
        const store = tx.objectStore("orders");
        const row = (await req(store.get(id))) as Stored<ConfirmedOrder> | undefined;
        if (!row) return;
        const next = patch({ ...strip(row), date: new Date(row.date) });
        store.put({ ...next, _pos: row._pos });
      }),

    maxOrderNumber: () =>
      run("orders", "readonly", (tx) =>
        maxKey(tx.objectStore("orders"), "orderNumber"),
      ),

    listProducts: products.list,
    upsertProduct: products.upsert,
    removeProduct: products.remove,
    replaceProducts: products.replaceAll,

    listCategories: categories.list,
    upsertCategory: categories.upsert,
    removeCategory: categories.remove,

    seedDefaults: (defaultProducts, defaultCategories) =>
      run(["products", "categories", "meta"], "readwrite", async (tx) => {
        const meta = tx.objectStore("meta");
        if (!(await req(meta.get(SEEDED_PRODUCTS)))) {
          const store = tx.objectStore("products");
          defaultProducts.forEach((p, i) => store.put({ ...p, _pos: i + 1 }));
          meta.put({ key: SEEDED_PRODUCTS, value: true });
        }
        if (!(await req(meta.get(SEEDED_CATEGORIES)))) {
          const store = tx.objectStore("categories");
          defaultCategories.forEach((c, i) => store.put({ ...c, _pos: i + 1 }));
          meta.put({ key: SEEDED_CATEGORIES, value: true });
        }
      }),
  };
}
