export interface OrderItem {
  id: string
  name: string
  price: number
  image: string
  quantity: number
  category: "arroces" | "entrantes" | "principales" | "postres"
}

export interface ConfirmedOrder {
  id: string
  orderNumber: number
  items: OrderItem[]
  total: number
  date: Date
  status: "completado" | "en_proceso" | "cancelado"
}
