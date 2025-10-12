import type { ConfirmedOrder } from "@/types/order"

const STORAGE_KEY = "confirmed_orders"

export function saveOrder(order: ConfirmedOrder): void {
  if (typeof window === "undefined") return

  const orders = getOrders()
  orders.unshift(order) // Añadir al principio
  localStorage.setItem(STORAGE_KEY, JSON.stringify(orders))
}

export function getOrders(): ConfirmedOrder[] {
  if (typeof window === "undefined") return []

  const stored = localStorage.getItem(STORAGE_KEY)
  if (!stored) return []

  const orders = JSON.parse(stored)
  // Convertir las fechas de string a Date
  return orders.map((order: any) => ({
    ...order,
    date: new Date(order.date),
  }))
}

export function deleteOrder(orderId: string): void {
  if (typeof window === "undefined") return

  const orders = getOrders()
  const filtered = orders.filter((order) => order.id !== orderId)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered))
}

export function updateOrderStatus(orderId: string, status: ConfirmedOrder["status"]): void {
  if (typeof window === "undefined") return

  const orders = getOrders()
  const updated = orders.map((order) => (order.id === orderId ? { ...order, status } : order))
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
}

export function updateOrder(orderId: string, items: ConfirmedOrder["items"]): void {
  if (typeof window === "undefined") return

  const orders = getOrders()
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const updated = orders.map((order) => (order.id === orderId ? { ...order, items, total } : order))
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
}

export function getNextOrderNumber(): number {
  const orders = getOrders()
  if (orders.length === 0) return 1
  return Math.max(...orders.map((o) => o.orderNumber)) + 1
}
