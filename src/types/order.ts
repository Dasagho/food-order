/** Línea de pedido tal y como vive en el cliente (carrito y pedidos mostrados). */
export interface OrderItem {
  /** Id del producto (o `n:<nombre>` si el servidor no conoce el producto). */
  id: string;
  name: string;
  /** Traducción del nombre (snapshot de la línea). */
  names?: { ar?: string };
  /** Precio unitario efectivamente cobrado (editable por línea). */
  price: number;
  /** Precio de catálogo en el momento de la venta (para saber cuánto se ajustó). */
  listPrice?: number;
  image: string;
  quantity: number;
  category?: MenuCategory;
  portionType?: "racion" | "unidades";
  halfPortionPrice?: number;
  isHalfPortion?: boolean;
}

export type OrderStatus = "completado" | "en_proceso" | "cancelado";
export type PaymentMethod = "efectivo" | "tarjeta" | "bizum";

export interface ConfirmedOrder {
  id: string;
  /** Número definitivo asignado por el servidor (0 si aún es pendiente). */
  orderNumber: number;
  items: OrderItem[];
  total: number;
  date: Date;
  status: OrderStatus;
  paymentMethod?: PaymentMethod;
  /** Importe entregado en efectivo y cambio (solo informativos). */
  amountReceived?: number | null;
  change?: number | null;
  /** Revisión del servidor (para If-Match). Los pedidos pendientes no la tienen. */
  revision?: number;
  /** El servidor aún no ha confirmado la creación (está en la cola de salida). */
  pending?: boolean;
  /** Número provisional "P-n" de un pedido pendiente. */
  provisionalNumber?: number;
  /** Hay cambios del cliente en la cola de salida aún sin confirmar. */
  hasPendingChanges?: boolean;
}

/** Los ids de categoría los decide el servidor (las 5 originales conservan el suyo). */
export type MenuCategory = string;

export interface MenuItem {
  id: string;
  name: string;
  names?: { ar?: string };
  price: number;
  image: string;
  category: MenuCategory;
  portionType: "racion" | "unidades";
  halfPortionPrice?: number;
  displayOrder?: number;
  available?: boolean;
}

/** Producto aún sin crear en el servidor (el id lo genera el servidor). */
export type ProductDraft = Omit<MenuItem, "id"> & { id?: string };

export interface Category {
  id: MenuCategory;
  name: string;
  names?: { ar?: string };
  displayOrder: number;
}
