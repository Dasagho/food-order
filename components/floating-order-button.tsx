

import { Button } from "@/components/ui/button"
import { ShoppingCart } from "lucide-react"
import type { OrderItem } from "@/types/order"

interface FloatingOrderButtonProps {
  items: OrderItem[]
  onClick: () => void
}

export function FloatingOrderButton({ items, onClick }: FloatingOrderButtonProps) {
  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0)
  const totalPrice = items.reduce((sum, item) => sum + item.price * item.quantity, 0)

  if (totalItems === 0) return null

  return (
    <Button
      onClick={onClick}
      className="fixed bottom-8 right-8 h-20 px-8 rounded-full shadow-2xl text-xl font-semibold bg-accent hover:bg-accent/90 text-accent-foreground z-50 flex items-center gap-4"
    >
      <div className="relative">
        <ShoppingCart className="w-10 h-10" />
        <span className="absolute -top-2 -right-2 bg-primary text-primary-foreground rounded-full w-7 h-7 flex items-center justify-center text-sm font-bold">
          {totalItems}
        </span>
      </div>
      <div className="flex flex-col items-start">
        <span className="text-base opacity-90">Ver pedido</span>
        <span className="text-2xl font-bold">€{totalPrice.toFixed(2)}</span>
      </div>
    </Button>
  )
}
