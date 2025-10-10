

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import type { OrderItem } from "@/types/order"
import { Minus, Plus, Trash2, ShoppingBag } from "lucide-react"

interface OrderSummaryProps {
  items: OrderItem[]
  onUpdateQuantity: (id: string, quantity: number) => void
  onRemoveItem: (id: string) => void
  onClearOrder: () => void
  onConfirmOrder: () => void
}

export function OrderSummary({
  items,
  onUpdateQuantity,
  onRemoveItem,
  onClearOrder,
  onConfirmOrder,
}: OrderSummaryProps) {
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0)

  return (
    <div className="flex flex-col h-full border-l border-border bg-card">
      <header className="border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-primary text-primary-foreground rounded-full p-2">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-foreground">Pedido</h2>
              <p className="text-sm text-muted-foreground">
                {itemCount} {itemCount === 1 ? "artículo" : "artículos"}
              </p>
            </div>
          </div>
          {items.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClearOrder}
              className="text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              Limpiar
            </Button>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="bg-muted rounded-full p-6 mb-4">
              <ShoppingBag className="w-12 h-12 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground text-lg">No hay artículos en el pedido</p>
            <p className="text-muted-foreground text-sm mt-2">Selecciona platos del menú</p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <Card key={item.id} className="p-4">
                <div className="flex items-start gap-3">
                  <img
                    src={item.image || "/placeholder.svg"}
                    alt={item.name}
                    className="w-16 h-16 rounded-md object-cover bg-secondary"
                  />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-foreground text-sm mb-1">{item.name}</h3>
                    <p className="text-primary font-bold">€{item.price.toFixed(2)}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onRemoveItem(item.id)}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>

                <div className="flex items-center justify-between mt-4">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => onUpdateQuantity(item.id, item.quantity - 1)}
                      className="h-10 w-10 rounded-full"
                    >
                      <Minus className="w-4 h-4" />
                    </Button>
                    <span className="text-lg font-semibold text-foreground w-12 text-center">{item.quantity}</span>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
                      className="h-10 w-10 rounded-full"
                    >
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>
                  <p className="text-lg font-bold text-foreground">€{(item.price * item.quantity).toFixed(2)}</p>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {items.length > 0 && (
        <div className="border-t border-border p-6 space-y-4">
          <div className="flex items-center justify-between text-lg">
            <span className="font-semibold text-foreground">Total</span>
            <span className="text-3xl font-bold text-primary">€{total.toFixed(2)}</span>
          </div>
          <Button
            size="lg"
            onClick={onConfirmOrder}
            className="w-full h-14 text-lg font-semibold bg-accent hover:bg-accent/90 text-accent-foreground"
          >
            Confirmar Pedido
          </Button>
        </div>
      )}
    </div>
  )
}
