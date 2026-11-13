import { request } from "./client";
import { UPLOAD_TIMEOUT_MS } from "@/lib/config";
import type {
  ApiCategory,
  ApiOrder,
  ApiProduct,
  CreateOrderBody,
  DailyReport,
  ImportOrdersResult,
  OrdersPage,
  PatchOrderBody,
} from "./types";

export * from "./client";
export * from "./types";

export interface ProductWriteBody {
  name?: string;
  names?: { ar?: string };
  categoryId?: string;
  portionType?: "racion" | "unidades";
  price?: number;
  halfPortionPrice?: number | null;
  imageUrl?: string;
  available?: boolean;
}

export interface OrderQuery {
  date?: string;
  from?: string;
  to?: string;
  status?: string;
  paymentMethod?: string;
  includeDeleted?: boolean;
}

/** Endpoints tipados del backend (SPEC §6). */
export const api = {
  categories: {
    list: () => request<ApiCategory[]>("GET", "/v1/categories"),
    create: (body: { name: string; names?: { ar?: string } }) =>
      request<ApiCategory>("POST", "/v1/categories", { body }),
    patch: (id: string, body: { name?: string; names?: { ar?: string } }) =>
      request<ApiCategory>("PATCH", `/v1/categories/${encodeURIComponent(id)}`, { body }),
    remove: (id: string) => request<void>("DELETE", `/v1/categories/${encodeURIComponent(id)}`),
    reorder: (ids: string[]) => request<void>("POST", "/v1/categories/reorder", { body: { ids } }),
  },

  products: {
    list: () => request<ApiProduct[]>("GET", "/v1/products"),
    create: (body: ProductWriteBody) => request<ApiProduct>("POST", "/v1/products", { body }),
    patch: (id: string, body: ProductWriteBody) =>
      request<ApiProduct>("PATCH", `/v1/products/${encodeURIComponent(id)}`, { body }),
    remove: (id: string) => request<void>("DELETE", `/v1/products/${encodeURIComponent(id)}`),
    reorder: (ids: string[]) => request<void>("POST", "/v1/products/reorder", { body: { ids } }),
  },

  uploads: {
    upload: (file: File | Blob) => {
      const form = new FormData();
      form.append("file", file);
      return request<{ url: string }>("POST", "/v1/uploads", { form, timeoutMs: UPLOAD_TIMEOUT_MS });
    },
  },

  orders: {
    /** Una página (el servidor pagina con cursor). */
    page: (q: OrderQuery & { limit?: number; cursor?: string }) =>
      request<OrdersPage>("GET", "/v1/orders", { query: { ...q } }),
    /** Todas las páginas. */
    async list(q: OrderQuery): Promise<ApiOrder[]> {
      const all: ApiOrder[] = [];
      let cursor: string | undefined;
      do {
        const page = await api.orders.page({ ...q, limit: 1000, cursor });
        all.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return all;
    },
    get: (id: string) => request<ApiOrder>("GET", `/v1/orders/${encodeURIComponent(id)}`),
    days: (from?: string, to?: string) =>
      request<{ day: string; count: number }[]>("GET", "/v1/orders/days", { query: { from, to } }),
    create: (body: CreateOrderBody) => request<ApiOrder>("POST", "/v1/orders", { body }),
    patch: (id: string, body: PatchOrderBody, revision?: number) =>
      request<ApiOrder>("PATCH", `/v1/orders/${encodeURIComponent(id)}`, {
        body,
        headers: revision !== undefined ? { "If-Match": `"${revision}"` } : undefined,
      }),
    remove: (id: string) => request<void>("DELETE", `/v1/orders/${encodeURIComponent(id)}`),
  },

  reports: {
    daily: (from: string, to: string) =>
      request<DailyReport[]>("GET", "/v1/reports/daily", { query: { from, to } }),
    /** CSV del rango (UTF-8 con BOM; se conservan los bytes tal cual para que Excel lo abra bien). */
    csv: (from: string, to: string) =>
      request<Blob>("GET", "/v1/reports/export.csv", { query: { from, to }, as: "blob" }),
  },

  import: {
    orders: (orders: unknown[]) =>
      request<ImportOrdersResult>("POST", "/v1/import/orders", { body: { orders } }),
    catalog: (categories: unknown[], products: unknown[]) =>
      request<ImportOrdersResult>("POST", "/v1/import/catalog", { body: { categories, products } }),
  },
};
