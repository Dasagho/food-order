

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import type { ConfirmedOrder } from "@/types/order"
import { X, Package, Calendar, CreditCard, Edit, Save, Minus, Plus, Trash2 } from "lucide-react"
import { updateOrderStatus, updateOrder } from "@/lib/order-storage"

interface OrderDetailModalProps {
  order: ConfirmedOrder
  onClose: () => void
  onUpdate: () => void
}

export function OrderDetailModal({ order, onClose, onUpdate }: OrderDetailModalProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editableItems, setEditableItems] = useState(order.items)

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat("es-ES", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date)
  }

  const handleStatusChange = (status: ConfirmedOrder["status"]) => {
    updateOrderStatus(order.id, status)
    onUpdate()
  }

  const handleQuantityChange = (itemId: string, delta: number) => {
    setEditableItems((items) =>
      items
        .map((item) => {
          if (item.id === itemId) {
            const newQuantity = Math.max(0, item.quantity + delta)
            return { ...item, quantity: newQuantity }
          }
          return item
        })
        .filter((item) => item.quantity > 0),
    )
  }

  const handleRemoveItem = (itemId: string) => {
    setEditableItems((items) => items.filter((item) => item.id !== itemId))
  }

  const handleSaveChanges = () => {
    if (editableItems.length === 0) {
      alert("El pedido debe tener al menos un artículo")
      return
    }
    updateOrder(order.id, editableItems)
    setIsEditing(false)
    onUpdate()
  }

  const handleCancelEdit = () => {
    setEditableItems(order.items)
    setIsEditing(false)
  }

  const currentItems = isEditing ? editableItems : order.items
  const itemCount = currentItems.reduce((sum, item) => sum + item.quantity, 0)
  const currentTotal = currentItems.reduce((sum, item) => sum + item.price * item.quantity, 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <Card className="w-full max-w-3xl max-h-[90vh] flex flex-col bg-card">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border p-6">
          <div className="flex items-center gap-3">
            <div className="bg-accent text-accent-foreground rounded-full p-2">
              <Package className="w-10 h-10" />
            </div>
            <div>
              <h2 className="text-3xl font-bold text-foreground">Pedido #{order.orderNumber}</h2>
              <p className="text-lg text-muted-foreground flex items-center gap-2 mt-1">
                <Calendar className="w-6 h-6" />
                {formatDate(order.date)}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0 h-12 w-12">
            <X className="w-8 h-8" />
          </Button>
        </div>

        {/* Order Items */}
        <div className="flex-1 overflow-y-auto p-6">
          {!isEditing && (
            <div className="mb-4">
              <Button
                variant="outline"
                onClick={() => setIsEditing(true)}
                className="w-full h-14 text-xl font-semibold border-accent text-accent hover:bg-accent/10"
              >
                <Edit className="w-7 h-7 mr-2" />
                Editar Pedido
              </Button>
            </div>
          )}

          <div className="space-y-3 mb-6">
            {currentItems.map((item) => (
              <Card key={item.id} className="p-4 bg-background">
                <div className="flex items-center gap-4">
                  <img
                    src={item.image || "/placeholder.svg"}
                    alt={item.name}
                    className="w-20 h-20 rounded-lg object-cover bg-secondary"
                  />
                  <div className="flex-1">
                    <h3 className="font-semibold text-foreground text-2xl mb-1">{item.name}</h3>
                    <p className="text-muted-foreground text-lg">€{item.price.toFixed(2)}</p>
                  </div>

                  {isEditing ? (
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2 bg-muted rounded-lg p-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleQuantityChange(item.id, -1)}
                          className="h-12 w-12 hover:bg-background"
                        >
                          <Minus className="w-7 h-7" />
                        </Button>
                        <span className="text-xl font-bold text-foreground w-12 text-center">{item.quantity}</span>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleQuantityChange(item.id, 1)}
                          className="h-12 w-12 hover:bg-background"
                        >
                          <Plus className="w-7 h-7" />
                        </Button>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleRemoveItem(item.id)}
                        className="h-12 w-12 text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="w-7 h-7" />
                      </Button>
                    </div>
                  ) : (
                    <div className="text-right">
                      <p className="text-lg text-muted-foreground mb-1">× {item.quantity}</p>
                      <p className="text-3xl font-bold text-primary">€{(item.price * item.quantity).toFixed(2)}</p>
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>

          {/* Summary */}
          <Card className="p-6 bg-muted/50">
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xl">
                <span className="text-muted-foreground">Artículos</span>
                <span className="font-semibold text-foreground">{itemCount}</span>
              </div>
              <div className="flex items-center justify-between text-xl">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-semibold text-foreground">€{currentTotal.toFixed(2)}</span>
              </div>
              <div className="border-t border-border pt-3 mt-3">
                <div className="flex items-center justify-between">
                  <span className="text-2xl font-bold text-foreground flex items-center gap-2">
                    <CreditCard className="w-7 h-7" />
                    Total
                  </span>
                  <span className="text-4xl font-bold text-primary">€{currentTotal.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </Card>

          {/* Status Management - Only show when not editing */}
          {!isEditing && (
            <div className="mt-6">
              <h3 className="text-xl font-semibold text-foreground mb-3">Estado del Pedido</h3>
              <div className="flex gap-2">
                <Button
                  variant={order.status === "en_proceso" ? "default" : "outline"}
                  size="lg"
                  onClick={() => handleStatusChange("en_proceso")}
                  className={
                    order.status === "en_proceso"
                      ? "bg-blue-500 hover:bg-blue-600 text-white h-12 text-base"
                      : "border-blue-500/20 text-blue-700 hover:bg-blue-500/10 h-12 text-base"
                  }
                >
                  En Proceso
                </Button>
                <Button
                  variant={order.status === "completado" ? "default" : "outline"}
                  size="lg"
                  onClick={() => handleStatusChange("completado")}
                  className={
                    order.status === "completado"
                      ? "bg-green-500 hover:bg-green-600 text-white h-12 text-base"
                      : "border-green-500/20 text-green-700 hover:bg-green-500/10 h-12 text-base"
                  }
                >
                  Completado
                </Button>
                <Button
                  variant={order.status === "cancelado" ? "default" : "outline"}
                  size="lg"
                  onClick={() => handleStatusChange("cancelado")}
                  className={
                    order.status === "cancelado"
                      ? "bg-red-500 hover:bg-red-600 text-white h-12 text-base"
                      : "border-red-500/20 text-red-700 hover:bg-red-500/10 h-12 text-base"
                  }
                >
                  Cancelado
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border p-6">
          {isEditing ? (
            <div className="flex gap-3">
              <Button
                size="lg"
                variant="outline"
                onClick={handleCancelEdit}
                className="flex-1 h-16 text-xl font-semibold bg-transparent"
              >
                Cancelar
              </Button>
              <Button
                size="lg"
                onClick={handleSaveChanges}
                className="flex-1 h-16 text-xl font-semibold bg-accent hover:bg-accent/90 text-accent-foreground"
              >
                <Save className="w-8 h-8 mr-2" />
                Guardar Cambios
              </Button>
            </div>
          ) : (
            <Button
              size="lg"
              onClick={onClose}
              className="w-full h-16 text-xl font-semibold bg-accent hover:bg-accent/90 text-accent-foreground"
            >
              Cerrar
            </Button>
          )}
        </div>
      </Card>
    </div>
  )
}
