/**
 * Cola de salida (SPEC §7). IndexedDB solo guarda trabajo pendiente: cuando el
 * servidor confirma una operación, la entrada se borra.
 *
 *  - FIFO, una operación cada vez.
 *  - Fusión (coalescing): lo que aún no está en el servidor se edita sobre su
 *    propia entrada `create`; un `delete` de un pedido sin crear la elimina.
 *  - Errores de red / timeout / 5xx / 429: se conserva y se reintenta con espera
 *    exponencial (2 s … 60 s con aleatoriedad) y al volver la conexión.
 *  - 401: el cliente HTTP ya intentó refrescar; si no hay sesión, se espera al login.
 *  - 412: la edición sin conexión pierde frente al servidor → se descarta y se avisa.
 *  - Otros 4xx: pasan a `outbox_failed` (la usuaria decide), nunca se pierden en silencio.
 */
import { ApiError, api } from "@/lib/api";
import type { ApiOrder, CreateOrderBody, PatchOrderBody } from "@/lib/api";
import { getSession } from "@/lib/auth/tokens";
import { req, run, withLock } from "@/lib/db";

export interface OutboxEntry {
  /** Clave de IndexedDB (autoincremental): define el orden FIFO. */
  seq?: number;
  opId: string;
  orderId: string;
  kind: "create" | "patch" | "delete";
  payload: CreateOrderBody | PatchOrderBody | null;
  createdAt: string;
  baseRevision?: number;
  /** create: número provisional "P-n" */
  provisional?: number;
  /** create: imágenes por línea, solo para mostrar el pedido pendiente */
  images?: Record<string, string>;
}

export interface FailedEntry extends OutboxEntry {
  error: { code: string; message: string; status: number };
  failedAt: string;
}

export type OutboxEvent =
  | { type: "change" }
  | { type: "confirmed"; entry: OutboxEntry; order?: ApiOrder }
  | { type: "conflict"; orderId: string; discarded: number }
  | { type: "failed"; entry: FailedEntry }
  | { type: "auth-required" };

export interface OutboxState {
  pending: number;
  failed: number;
  authRequired: boolean;
  /** Instante (ms) del próximo reintento programado, si lo hay. */
  retryAt: number | null;
}

const BACKOFF_BASE_MS = 2_000;
const BACKOFF_MAX_MS = 60_000;

/** Espera exponencial con aleatoriedad (±25 %), acotada a 60 s. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1));
  return Math.min(BACKOFF_MAX_MS, Math.round(base * (0.75 + random() * 0.5)));
}

const uuid = () => crypto.randomUUID();

// ───────────── estado en memoria ─────────────
let inflightSeq: number | null = null;
let running: Promise<void> | null = null;
let rerun = false;
let attempts = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let retryAt: number | null = null;
let authRequired = false;
let started = false;
const listeners = new Set<(e: OutboxEvent) => void>();

const emit = (e: OutboxEvent) => listeners.forEach((l) => l(e));

export function subscribe(fn: (e: OutboxEvent) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ───────────── lectura ─────────────
export const listPending = (): Promise<OutboxEntry[]> =>
  run("outbox", "readonly", (tx) => req(tx.objectStore("outbox").getAll()) as Promise<OutboxEntry[]>);

export const listFailed = (): Promise<FailedEntry[]> =>
  run("outbox_failed", "readonly", (tx) => req(tx.objectStore("outbox_failed").getAll()) as Promise<FailedEntry[]>);

export async function getState(): Promise<OutboxState> {
  const [p, f] = await Promise.all([listPending(), listFailed()]);
  return { pending: p.length, failed: f.length, authRequired, retryAt };
}

// ───────────── escritura con fusión ─────────────
const forOrder = async (tx: IDBTransaction, orderId: string): Promise<OutboxEntry[]> =>
  ((await req(tx.objectStore("outbox").index("orderId").getAll(orderId))) as OutboxEntry[]).sort(
    (a, b) => a.seq! - b.seq!,
  );

/** Añade una creación. Devuelve la entrada guardada (con su número provisional). */
export async function enqueueCreate(
  payload: CreateOrderBody,
  images: Record<string, string> = {},
): Promise<OutboxEntry> {
  const entry = await run("outbox", "readwrite", async (tx) => {
    const store = tx.objectStore("outbox");
    const all = (await req(store.getAll())) as OutboxEntry[];
    const provisional = all.reduce((m, e) => Math.max(m, e.provisional ?? 0), 0) + 1;
    const e: OutboxEntry = {
      opId: uuid(),
      orderId: payload.id,
      kind: "create",
      payload,
      createdAt: new Date().toISOString(),
      provisional,
      images,
    };
    // Reintento del mismo pedido (mismo id): no se duplica la entrada
    const dup = all.find((x) => x.kind === "create" && x.orderId === payload.id);
    if (dup) return dup;
    e.seq = (await req(store.add(e))) as number;
    return e;
  });
  emit({ type: "change" });
  return entry;
}

/**
 * Edita un pedido. Si todavía no existe en el servidor, el cambio se aplica a su
 * entrada `create` (una sola petición); si no, se fusiona con el último `patch` o
 * se añade uno nuevo con la revisión en la que se basó la edición.
 */
export async function enqueuePatch(
  orderId: string,
  patch: PatchOrderBody,
  baseRevision?: number,
): Promise<void> {
  await run("outbox", "readwrite", async (tx) => {
    const store = tx.objectStore("outbox");
    const entries = await forOrder(tx, orderId);
    if (entries.some((e) => e.kind === "delete")) return; // se está borrando: nada que editar
    const create = entries.find((e) => e.kind === "create");
    if (create && create.seq !== inflightSeq) {
      store.put({ ...create, payload: { ...(create.payload as CreateOrderBody), ...patch } });
      return;
    }
    const last = [...entries].reverse().find((e) => e.kind === "patch" && e.seq !== inflightSeq);
    if (last) {
      store.put({
        ...last,
        payload: { ...(last.payload as PatchOrderBody), ...patch },
        baseRevision: last.baseRevision ?? baseRevision,
      });
      return;
    }
    store.add({
      opId: uuid(),
      orderId,
      kind: "patch",
      payload: patch,
      createdAt: new Date().toISOString(),
      baseRevision,
    } satisfies OutboxEntry);
  });
  emit({ type: "change" });
}

/** Borra un pedido. Si nunca llegó al servidor, la entrada simplemente desaparece. */
export async function enqueueDelete(orderId: string): Promise<{ cancelledLocally: boolean }> {
  const result = await run("outbox", "readwrite", async (tx) => {
    const store = tx.objectStore("outbox");
    const entries = await forOrder(tx, orderId);
    if (entries.some((e) => e.kind === "delete")) return { cancelledLocally: false };
    const create = entries.find((e) => e.kind === "create");
    const removable = entries.filter((e) => e.seq !== inflightSeq);
    if (create && create.seq !== inflightSeq) {
      removable.forEach((e) => store.delete(e.seq!));
      return { cancelledLocally: true };
    }
    removable.filter((e) => e.kind === "patch").forEach((e) => store.delete(e.seq!));
    store.add({
      opId: uuid(),
      orderId,
      kind: "delete",
      payload: null,
      createdAt: new Date().toISOString(),
    } satisfies OutboxEntry);
    return { cancelledLocally: false };
  });
  emit({ type: "change" });
  return result;
}

/**
 * Descarta un pedido que aún NO ha llegado al servidor (decisión del dueño, SPEC §8.1): elimina su
 * entrada `create` y las ediciones encoladas sobre ella, sin dejar rastro. Si la creación ya se está
 * enviando (o ya se confirmó) no se puede descartar: devuelve el motivo.
 */
export async function discardPendingCreate(
  orderId: string,
): Promise<{ discarded: true } | { discarded: false; reason: "synced" | "sending" }> {
  const result = await run("outbox", "readwrite", async (tx) => {
    const store = tx.objectStore("outbox");
    const entries = await forOrder(tx, orderId);
    const create = entries.find((e) => e.kind === "create");
    if (!create) return { discarded: false, reason: "synced" } as const;
    if (entries.some((e) => e.seq === inflightSeq)) return { discarded: false, reason: "sending" } as const;
    entries.forEach((e) => store.delete(e.seq!));
    return { discarded: true } as const;
  });
  if (result.discarded) emit({ type: "change" });
  return result;
}

// ───────────── procesamiento ─────────────
async function firstEntry(): Promise<OutboxEntry | undefined> {
  return run("outbox", "readonly", async (tx) => {
    const cursor = await req(tx.objectStore("outbox").openCursor());
    return cursor ? (cursor.value as OutboxEntry) : undefined;
  });
}

/** Borra la entrada confirmada y propaga la revisión del servidor a las ediciones posteriores. */
async function confirm(entry: OutboxEntry, order?: ApiOrder): Promise<void> {
  await run("outbox", "readwrite", async (tx) => {
    const store = tx.objectStore("outbox");
    store.delete(entry.seq!);
    if (order) {
      for (const e of await forOrder(tx, entry.orderId)) {
        if (e.seq! > entry.seq! && e.kind === "patch") store.put({ ...e, baseRevision: order.revision });
      }
    }
  });
}

async function moveToFailed(entry: OutboxEntry, error: ApiError, includeDependents: boolean): Promise<FailedEntry> {
  const failedAt = new Date().toISOString();
  const info = { code: error.code, message: error.message, status: error.status };
  const failed: FailedEntry = { ...entry, error: info, failedAt };
  await run(["outbox", "outbox_failed"], "readwrite", async (tx) => {
    tx.objectStore("outbox").delete(entry.seq!);
    tx.objectStore("outbox_failed").put(failed);
    if (includeDependents) {
      for (const e of await forOrder(tx, entry.orderId)) {
        if (e.seq === entry.seq) continue;
        tx.objectStore("outbox").delete(e.seq!);
        tx.objectStore("outbox_failed").put({
          ...e,
          error: { ...info, code: "dependent_failed" },
          failedAt,
        } satisfies FailedEntry);
      }
    }
  });
  return failed;
}

/** 412: la edición sin conexión pierde. Se descarta (y las ediciones posteriores sobre la misma base). */
async function discardConflicting(entry: OutboxEntry): Promise<number> {
  return run("outbox", "readwrite", async (tx) => {
    const store = tx.objectStore("outbox");
    let n = 1;
    store.delete(entry.seq!);
    for (const e of await forOrder(tx, entry.orderId)) {
      if (e.seq! > entry.seq! && e.kind === "patch") {
        store.delete(e.seq!);
        n++;
      }
    }
    return n;
  });
}

async function send(entry: OutboxEntry): Promise<ApiOrder | undefined> {
  switch (entry.kind) {
    case "create":
      return api.orders.create(entry.payload as CreateOrderBody);
    case "patch":
      return api.orders.patch(entry.orderId, entry.payload as PatchOrderBody, entry.baseRevision);
    case "delete":
      try {
        await api.orders.remove(entry.orderId);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return undefined; // ya no existe: confirmado
        throw e;
      }
      return undefined;
  }
}

function schedule(delayMs: number) {
  if (timer) clearTimeout(timer);
  retryAt = Date.now() + delayMs;
  timer = setTimeout(() => {
    timer = null;
    retryAt = null;
    void flush();
  }, delayMs);
  emit({ type: "change" });
}

async function loop(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
    retryAt = null;
  }
  for (;;) {
    const entry = await firstEntry();
    if (!entry) {
      attempts = 0;
      authRequired = false;
      break;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) break; // 'online' lo reanuda
    if (!(await getSession())) {
      authRequired = true;
      emit({ type: "auth-required" });
      break; // la cola queda intacta hasta que se inicie sesión
    }
    inflightSeq = entry.seq!;
    try {
      const order = await send(entry);
      await confirm(entry, order);
      attempts = 0;
      authRequired = false;
      emit({ type: "confirmed", entry, order });
      emit({ type: "change" });
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, "network_error", String(e));
      if (err.status === 401) {
        if (!(await getSession())) {
          authRequired = true;
          emit({ type: "auth-required" });
          break;
        }
        attempts++;
        schedule(backoffDelay(attempts));
        break;
      }
      if (err.retryable) {
        attempts++;
        schedule(backoffDelay(attempts));
        break;
      }
      if (err.status === 412) {
        const discarded = await discardConflicting(entry);
        emit({ type: "conflict", orderId: entry.orderId, discarded });
        emit({ type: "change" });
        continue;
      }
      const failed = await moveToFailed(entry, err, entry.kind === "create");
      emit({ type: "failed", entry: failed });
      emit({ type: "change" });
    } finally {
      inflightSeq = null;
    }
  }
}

/** Procesa la cola (un solo procesamiento a la vez, también entre pestañas si hay Web Locks). */
export function flush(): Promise<void> {
  if (running) {
    rerun = true;
    return running;
  }
  running = withLock("food-order-outbox", loop)
    .catch((e) => console.error("[outbox] error inesperado", e))
    .finally(() => {
      running = null;
      emit({ type: "change" });
      if (rerun) {
        rerun = false;
        void flush();
      }
    });
  return running;
}

/** Arranca la sincronización: reanuda al recuperar la conexión y procesa lo pendiente. */
export function start(): void {
  if (!started && typeof window !== "undefined") {
    started = true;
    window.addEventListener("online", () => {
      attempts = 0;
      void flush();
    });
  }
  void flush();
}

// ───────────── pedidos rechazados ─────────────
export async function retryFailed(opId: string): Promise<void> {
  await run(["outbox", "outbox_failed"], "readwrite", async (tx) => {
    const failed = (await req(tx.objectStore("outbox_failed").get(opId))) as FailedEntry | undefined;
    if (!failed) return;
    const { error: _e, failedAt: _f, seq: _s, ...entry } = failed;
    tx.objectStore("outbox_failed").delete(opId);
    tx.objectStore("outbox").add(entry);
  });
  emit({ type: "change" });
  void flush();
}

export async function discardFailed(opId: string): Promise<void> {
  await run("outbox_failed", "readwrite", async (tx) => {
    tx.objectStore("outbox_failed").delete(opId);
  });
  emit({ type: "change" });
}

/** Solo para tests: olvida temporizadores y estado de módulo. */
export function _reset() {
  if (timer) clearTimeout(timer);
  timer = null;
  retryAt = null;
  inflightSeq = null;
  running = null;
  rerun = false;
  attempts = 0;
  authRequired = false;
  listeners.clear();
}
