// Tipos del contrato (food-order-api/SPEC.md §6)

export type PaymentMethod = "efectivo" | "tarjeta" | "bizum";
export type OrderStatus = "en_proceso" | "completado" | "cancelado";

export interface ApiCategory {
  id: string;
  name: string;
  names: { ar?: string };
  position: number;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ApiProduct {
  id: string;
  name: string;
  names: { ar?: string };
  price: number;
  halfPortionPrice: number | null;
  portionType: "racion" | "unidades";
  categoryId: string;
  imageUrl: string;
  available: boolean;
  position: number;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ApiOrderItem {
  productId: string | null;
  name: string;
  names?: { ar?: string };
  unitPrice: number;
  listPrice: number | null;
  quantity: number;
  half: boolean;
  imageUrl?: string | null;
}

export interface ApiOrder {
  id: string;
  number: number;
  businessDay: string;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  total: number;
  amountReceived: number | null;
  change: number | null;
  createdAt: string;
  updatedAt: string;
  revision: number;
  legacyNumber: number | null;
  deletedAt: string | null;
  items: ApiOrderItem[];
}

/** Cuerpo de POST /orders (idempotente por id) */
export interface CreateOrderBody {
  id: string;
  createdAt: string;
  status?: OrderStatus;
  paymentMethod: PaymentMethod;
  amountReceived?: number;
  items: {
    productId: string | null;
    name: string;
    names?: { ar?: string };
    unitPrice: number;
    listPrice?: number | null;
    quantity: number;
    half: boolean;
  }[];
}

/** Cuerpo de PATCH /orders/:id */
export interface PatchOrderBody {
  status?: OrderStatus;
  paymentMethod?: PaymentMethod;
  /** `null` borra el importe entregado. */
  amountReceived?: number | null;
  createdAt?: string;
  number?: number;
  items?: CreateOrderBody["items"];
}

export interface OrdersPage {
  items: ApiOrder[];
  nextCursor: string | null;
}

export interface DailyReport {
  day: string;
  orders: number;
  units: number;
  total: number;
  byPaymentMethod: Record<PaymentMethod, number>;
  byProduct: {
    productId: string | null;
    name: string;
    names?: { ar?: string };
    half: boolean;
    quantity: number;
    total: number;
  }[];
  cancelled: { orders: number; total: number };
}

/** Respuesta de POST /import/orders y /import/catalog (200 aunque haya elementos rechazados). */
export interface ImportOrdersResult {
  created: number;
  updated?: number; // solo el catálogo
  skipped: number;
  errors: { id: string; reason: string }[];
}
