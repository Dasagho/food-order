import type { Category, ConfirmedOrder, MenuItem } from "@/types/order";

/**
 * Contrato único de persistencia. Hay dos implementaciones:
 *  - IndexedDB (principal)
 *  - localStorage (solo como red de seguridad si IndexedDB no está disponible)
 */
export interface Backend {
  readonly kind: "indexeddb" | "localstorage";

  // Pedidos (más reciente primero)
  listOrders(): Promise<ConfirmedOrder[]>;
  addOrder(order: ConfirmedOrder): Promise<void>;
  removeOrder(id: string): Promise<void>;
  patchOrder(
    id: string,
    patch: (o: ConfirmedOrder) => ConfirmedOrder,
  ): Promise<void>;
  maxOrderNumber(): Promise<number>;

  // Productos (orden de lista significativo)
  listProducts(): Promise<MenuItem[]>;
  upsertProduct(p: MenuItem): Promise<void>;
  removeProduct(id: string): Promise<void>;
  replaceProducts(list: MenuItem[]): Promise<void>;

  // Categorías
  listCategories(): Promise<Category[]>;
  upsertCategory(c: Category): Promise<void>;
  removeCategory(id: string): Promise<void>;

  /** Siembra los valores por defecto SOLO la primera vez (nunca tras borrar). */
  seedDefaults(products: MenuItem[], categories: Category[]): Promise<void>;
}
