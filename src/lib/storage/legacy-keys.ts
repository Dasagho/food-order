// Claves usadas por la versión original basada en localStorage.
export const LS_ORDERS = "confirmed_orders";
export const LS_PRODUCTS = "menu_products";
export const LS_CATEGORIES = "menu_categories";

/** Lee un array JSON de localStorage. null si no existe o está corrupto. */
export function readLegacyArray<T = any>(key: string): T[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch (e) {
    console.error(`[storage] No se pudo leer "${key}" de localStorage`, e);
    return null;
  }
}
