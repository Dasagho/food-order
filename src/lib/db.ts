/**
 * IndexedDB local. Con el servidor como fuente de verdad, aquí solo vive:
 *  - `auth`          tokens de sesión (y el verificador PKCE durante el login)
 *  - `outbox`        operaciones de pedidos pendientes de confirmar (FIFO por `seq`)
 *  - `outbox_failed` operaciones rechazadas por el servidor (visibles a la usuaria)
 *  - `catalog`       caché pequeña de categorías/productos para trabajar sin conexión
 *  - `meta`          marcas mínimas (importación hecha, persistencia solicitada…)
 * Los almacenes `orders`, `products` y `categories` son los de la versión anterior:
 * solo se leen para la importación única al servidor y después se vacían.
 */
export const DB_NAME = "food-order";
export const DB_VERSION = 2;

export type StoreName =
  | "auth"
  | "outbox"
  | "outbox_failed"
  | "catalog"
  | "meta"
  | "orders"
  | "products"
  | "categories";

let dbPromise: Promise<IDBDatabase> | null = null;

export const req = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });

export const txDone = (tx: IDBTransaction): Promise<void> =>
  new Promise((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error ?? new Error("transacción abortada"));
  });

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      const has = (n: string) => db.objectStoreNames.contains(n);
      // Almacenes de la versión 1 (se conservan para poder importarlos)
      if (!has("orders")) {
        const orders = db.createObjectStore("orders", { keyPath: "id" });
        orders.createIndex("seq", "_pos");
        orders.createIndex("orderNumber", "orderNumber");
      }
      if (!has("products"))
        db.createObjectStore("products", { keyPath: "id" }).createIndex("pos", "_pos");
      if (!has("categories"))
        db.createObjectStore("categories", { keyPath: "id" }).createIndex("pos", "_pos");
      if (!has("meta")) db.createObjectStore("meta", { keyPath: "key" });
      // Almacenes nuevos
      if (!has("auth")) db.createObjectStore("auth", { keyPath: "key" });
      if (!has("outbox")) {
        const outbox = db.createObjectStore("outbox", { keyPath: "seq", autoIncrement: true });
        outbox.createIndex("orderId", "orderId");
      }
      if (!has("outbox_failed")) db.createObjectStore("outbox_failed", { keyPath: "opId" });
      if (!has("catalog")) db.createObjectStore("catalog", { keyPath: "key" });
    };
    r.onsuccess = () => {
      const db = r.result;
      // Si otra pestaña pide actualizar el esquema, liberamos la conexión
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error("apertura de IndexedDB bloqueada"));
  });
}

export function getDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = open();
    dbPromise.catch(() => (dbPromise = null));
  }
  return dbPromise;
}

/** Cierra la conexión y olvida el singleton (tests y recarga de módulos). */
export async function closeDb(): Promise<void> {
  if (!dbPromise) return;
  const p = dbPromise;
  dbPromise = null;
  try {
    (await p).close();
  } catch {
    /* ya estaba cerrada */
  }
}

/** Ejecuta `fn` dentro de una transacción y devuelve su resultado cuando ésta termina. */
export async function run<T>(
  stores: StoreName | StoreName[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => Promise<T>,
): Promise<T> {
  const db = await getDb();
  const tx = db.transaction(stores, mode);
  const finished = txDone(tx);
  try {
    const value = await fn(tx);
    await finished;
    return value;
  } catch (e) {
    try {
      tx.abort();
    } catch {
      /* ya terminada */
    }
    finished.catch(() => {});
    throw e;
  }
}

export const dbGet = <T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> =>
  run(store, "readonly", (tx) => req(tx.objectStore(store).get(key)) as Promise<T | undefined>);

export const dbPut = (store: StoreName, value: unknown): Promise<void> =>
  run(store, "readwrite", async (tx) => {
    tx.objectStore(store).put(value);
  });

export const dbDelete = (store: StoreName, key: IDBValidKey): Promise<void> =>
  run(store, "readwrite", async (tx) => {
    tx.objectStore(store).delete(key);
  });

export const dbAll = <T>(store: StoreName): Promise<T[]> =>
  run(store, "readonly", (tx) => req(tx.objectStore(store).getAll()) as Promise<T[]>);

export const dbCount = (store: StoreName): Promise<number> =>
  run(store, "readonly", (tx) => req(tx.objectStore(store).count()));

// ───────────── meta ─────────────
export async function getMeta<T = unknown>(key: string): Promise<T | undefined> {
  const row = await dbGet<{ key: string; value: T }>("meta", key);
  return row?.value;
}
export const setMeta = (key: string, value: unknown) => dbPut("meta", { key, value });

/** Exclusión mutua entre pestañas (Web Locks) si el navegador la ofrece. */
export async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const locks = (globalThis as any).navigator?.locks;
  if (locks?.request) return locks.request(name, fn) as Promise<T>;
  return fn();
}
