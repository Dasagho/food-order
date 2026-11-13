/**
 * Catálogo (categorías y productos). La fuente de verdad es el servidor; en IndexedDB
 * (`catalog`) queda una caché pequeña para poder tomar pedidos sin conexión.
 * Editar el catálogo y subir imágenes exige conexión.
 *
 * Se refresca entero en cada arranque y cada 5 min. Son unos pocos KB y así los cambios
 * de orden (que pueden no tocar `updatedAt`) nunca quedan obsoletos, a diferencia de
 * `updatedSince` (ver informe: desviación propuesta de SPEC §7).
 */
import { api } from "@/lib/api";
import type { ProductWriteBody } from "@/lib/api";
import { dbGet, dbPut } from "@/lib/db";
import { categoryFromApi, productFromApi, roundMoney } from "@/lib/mapping";
import type { Category, MenuItem, ProductDraft } from "@/types/order";

export interface Catalog {
  products: MenuItem[];
  categories: Category[];
  /** Instante (ms) del último refresco correcto contra el servidor. */
  syncedAt: number;
}

const REFRESH_EVERY_MS = 5 * 60 * 1000;
const listeners = new Set<(c: Catalog) => void>();
let inflight: Promise<Catalog> | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

export function subscribeCatalog(fn: (c: Catalog) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function readCatalogCache(): Promise<Catalog | null> {
  const row = await dbGet<{ key: string; value: Catalog }>("catalog", "catalog");
  return row?.value ?? null;
}

/** Consulta al servidor y actualiza la caché (un solo refresco a la vez). */
export function refreshCatalog(): Promise<Catalog> {
  if (!inflight) {
    inflight = (async () => {
      const [products, categories] = await Promise.all([api.products.list(), api.categories.list()]);
      const catalog: Catalog = {
        products: products.filter((p) => !p.deletedAt).sort((a, b) => a.position - b.position).map(productFromApi),
        categories: categories.filter((c) => !c.deletedAt).sort((a, b) => a.position - b.position).map(categoryFromApi),
        syncedAt: Date.now(),
      };
      await dbPut("catalog", { key: "catalog", value: catalog });
      listeners.forEach((l) => l(catalog));
      return catalog;
    })().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

/** Refresca ahora y cada 5 minutos. Devuelve la función que lo detiene. */
export function startCatalogSync(): () => void {
  refreshCatalog().catch(() => {});
  if (timer) clearInterval(timer);
  timer = setInterval(() => refreshCatalog().catch(() => {}), REFRESH_EVERY_MS);
  return () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
}

/** Caché primero (arranca sin red); si no hay caché, espera al servidor. */
async function catalog(): Promise<Catalog> {
  const cached = await readCatalogCache();
  if (cached) return cached;
  return refreshCatalog();
}

export async function getProducts(): Promise<MenuItem[]> {
  return (await catalog()).products;
}

export async function getCategories(): Promise<Category[]> {
  return (await catalog()).categories;
}

// ───────────── escrituras (requieren conexión) ─────────────
function toBody(p: ProductDraft): ProductWriteBody {
  const racion = p.portionType === "racion";
  return {
    name: p.name.trim(),
    // names reemplaza el objeto completo: `{}` borra la traducción
    names: p.names?.ar?.trim() ? { ar: p.names.ar.trim() } : {},
    categoryId: p.category,
    portionType: p.portionType,
    price: roundMoney(p.price),
    // La media ración solo existe en raciones con precio; null la borra
    halfPortionPrice: racion && p.halfPortionPrice && p.halfPortionPrice > 0 ? roundMoney(p.halfPortionPrice) : null,
    imageUrl: p.image,
    available: p.available ?? true,
  };
}

/** Crea (sin id) o actualiza (con id) un producto y refresca la caché. */
export async function saveProduct(product: ProductDraft): Promise<void> {
  const body = toBody(product);
  if (product.id) await api.products.patch(product.id, body);
  else {
    if (body.halfPortionPrice === null) delete body.halfPortionPrice;
    await api.products.create(body);
  }
  await refreshCatalog();
}

export async function deleteProduct(productId: string): Promise<void> {
  await api.products.remove(productId);
  await refreshCatalog();
}

/** Reordena enviando la lista EXACTA de ids (cualquier otra cosa da 409 reorder_mismatch). */
export async function reorderProducts(ids: string[]): Promise<void> {
  await api.products.reorder(ids);
  await refreshCatalog();
}

/** Sube una imagen y devuelve la URL a guardar en el producto. */
export async function uploadImage(file: File): Promise<string> {
  return (await api.uploads.upload(file)).url;
}

// ───────────── secciones (categorías) ─────────────
const catNames = (ar?: string) => (ar?.trim() ? { ar: ar.trim() } : {});

/** Crea (sin id) o renombra (con id) una sección. */
export async function saveCategory(input: { id?: string; name: string; ar?: string }): Promise<void> {
  const body = { name: input.name.trim(), names: catNames(input.ar) };
  if (input.id) await api.categories.patch(input.id, body);
  else await api.categories.create(body);
  await refreshCatalog();
}

/** Borrado lógico; 409 `category_not_empty` si aún tiene platos. */
export async function deleteCategory(id: string): Promise<void> {
  await api.categories.remove(id);
  await refreshCatalog();
}

/** Lista EXACTA de ids (cualquier otra cosa da 409 reorder_mismatch). */
export async function reorderCategories(ids: string[]): Promise<void> {
  await api.categories.reorder(ids);
  await refreshCatalog();
}

/** Marca un producto como disponible / agotado. */
export async function setAvailability(productId: string, available: boolean): Promise<void> {
  await api.products.patch(productId, { available });
  await refreshCatalog();
}
