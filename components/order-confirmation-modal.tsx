

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import type { OrderItem } from "@/types/order"
import { X, CheckCircle2, ShoppingBag } from "lucide-react"

interface OrderConfirmationModalProps {
  isOpen: boolean
  onClose: () => void
  items: OrderItem[]
  onConfirm: () => void
}

export function OrderConfirmationModal({ isOpen, onClose, items, onConfirm }: OrderConfirmationModalProps) {
  if (!isOpen) return null

  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0)
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <Card className="w-full max-w-2xl max-h-[90vh] flex flex-col bg-card">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border p-6">
          <div className="flex items-center gap-3">
            <div className="bg-accent text-accent-foreground rounded-full p-2">
              <ShoppingBag className="w-10 h-10" />
            </div>
            <div>
              <h2 className="text-3xl font-bold text-foreground">Confirmar Pedido</h2>
              <p className="text-lg text-muted-foreground">Revisa tu pedido antes de confirmar</p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0 h-12 w-12">
            <X className="w-8 h-8" />
          </Button>
        </div>

        <div className="p-6 border-b border-border">
          <Card className="p-6 bg-muted/50">
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xl">
                <span className="text-muted-foreground">Artículos</span>
                <span className="font-semibold text-foreground">{itemCount}</span>
              </div>
              <div className="flex items-center justify-between text-xl">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-semibold text-foreground">€{total.toFixed(2)}</span>
              </div>
              <div className="border-t border-border pt-3 mt-3">
                <div className="flex items-center justify-between">
                  <span className="text-2xl font-bold text-foreground">Total</span>
                  <span className="text-4xl font-bold text-primary">€{total.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* Order Items */}
        <div className="flex-1 overflow-y-auto p-6">
          <h3 className="text-2xl font-semibold text-foreground mb-4">Artículos del pedido</h3>
          <div className="space-y-3">
            {items.map((item) => (
              <Card key={item.id} className="p-4 bg-background">
                <div className="flex items-center gap-4">
                  <img
                    src={item.image || "/placeholder.svg"}
                    alt={item.name}
                    className="w-20 h-20 rounded-lg object-cover bg-secondary"
                  />
                  <div className="flex-1">
                    <h3 className="font-semibold text-foreground text-2xl mb-1">{item.name}</h3>
                    <p className="text-muted-foreground text-lg">
                      €{item.price.toFixed(2)} × {item.quantity}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-3xl font-bold text-primary">€{(item.price * item.quantity).toFixed(2)}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="border-t border-border p-6 flex gap-3">
          <Button
            variant="outline"
            size="lg"
            onClick={onClose}
            className="flex-1 h-16 text-xl font-semibold bg-transparent"
          >
            Cancelar
          </Button>
          <Button
            size="lg"
            onClick={onConfirm}
            className="flex-1 h-16 text-xl font-semibold bg-accent hover:bg-accent/90 text-accent-foreground"
          >
            <CheckCircle2 className="w-8 h-8 mr-2" />
            Confirmar Pedido
          </Button>
        </div>
      </Card>
    </div>
  )
}
