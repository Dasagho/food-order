import type { ConfirmedOrder, OrderStatus } from "@/types/order";

/**
 * Reglas de la caja (SPEC §8). Las aplica el cliente, no el servidor:
 * solo los pedidos `en_proceso` se editan; `completado` y `cancelado` son de solo lectura
 * (su corrección se hace desde la administración del servidor).
 */
export const canEditFromRegister = (o: Pick<ConfirmedOrder, "status">) => o.status === "en_proceso";

/** Transiciones permitidas desde la caja. */
export const allowedTransitions = (o: Pick<ConfirmedOrder, "status">): OrderStatus[] =>
  o.status === "en_proceso" ? ["completado", "cancelado"] : [];

export class OrderRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrderRuleError";
  }
}
