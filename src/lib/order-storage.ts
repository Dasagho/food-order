import type { ConfirmedOrder } from "@/types/order"
import { getBackend } from "./storage"

export async function saveOrder(order: ConfirmedOrder): Promise<void> {
  await (await getBackend()).addOrder(order)
}

export async function getOrders(): Promise<ConfirmedOrder[]> {
  return (await getBackend()).listOrders()
}

export async function deleteOrder(orderId: string): Promise<void> {
  await (await getBackend()).removeOrder(orderId)
}

export async function updateOrderStatus(orderId: string, status: ConfirmedOrder["status"]): Promise<void> {
  await (await getBackend()).patchOrder(orderId, (order) => ({ ...order, status }))
}

export async function updateOrder(orderId: string, items: ConfirmedOrder["items"]): Promise<void> {
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0)
  await (await getBackend()).patchOrder(orderId, (order) => ({ ...order, items, total }))
}

export async function getNextOrderNumber(): Promise<number> {
  return (await (await getBackend()).maxOrderNumber()) + 1
}
