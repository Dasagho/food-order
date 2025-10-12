

import { useState } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { menuItems, categoryNames } from "@/data/menu-items"
import type { OrderItem, MenuCategory } from "@/types/order"
import { Plus, Minus } from "lucide-react"

interface MenuGridProps {
  onAddToOrder: (item: OrderItem) => void
  orderItems: OrderItem[]
  onUpdateQuantity: (id: string, quantity: number) => void
}

export function MenuGrid({ onAddToOrder, orderItems, onUpdateQuantity }: MenuGridProps) {
  const [selectedCategory, setSelectedCategory] = useState<MenuCategory | "all">("all")

  const getItemQuantity = (itemId: string) => {
    const orderItem = orderItems.find((item) => item.id === itemId)
    return orderItem?.quantity || 0
  }

  const filteredItems =
    selectedCategory === "all" ? menuItems : menuItems.filter((item) => item.category === selectedCategory)

  const categories: Array<{ value: MenuCategory | "all"; label: string }> = [
    { value: "all", label: "Todos" },
    { value: "arroces", label: categoryNames.arroces },
    { value: "entrantes", label: categoryNames.entrantes },
    { value: "principales", label: categoryNames.principales },
    { value: "postres", label: categoryNames.postres },
  ]

  return (
    <div className="flex flex-col h-full">
      <header className="border-b border-border bg-card px-6 py-6">
        <h1 className="text-4xl font-semibold text-foreground">Menú</h1>
        <p className="text-lg text-muted-foreground mt-2">Selecciona los platos para tu pedido</p>
      </header>

      <div className="border-b border-border bg-card px-6 py-4 overflow-x-auto">
        <div className="flex gap-3 min-w-max">
          {categories.map((category) => (
            <Button
              key={category.value}
              variant={selectedCategory === category.value ? "default" : "outline"}
              onClick={() => setSelectedCategory(category.value)}
              className="h-14 px-8 text-xl font-medium whitespace-nowrap"
            >
              {category.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {filteredItems.map((item) => {
            const quantity = getItemQuantity(item.id)

            return (
              <Card
                key={item.id}
                className="overflow-hidden hover:shadow-xl hover:scale-[1.02] transition-all cursor-pointer"
                onClick={() => {
                  if (quantity === 0) {
                    onAddToOrder(item)
                  }
                }}
              >
                <div className="aspect-square bg-secondary relative overflow-hidden">
                  <img src={item.image || "/placeholder.svg"} alt={item.name} className="w-full h-full object-cover" />
                  {quantity > 0 && (
                    <div className="absolute top-3 right-3 bg-accent text-accent-foreground rounded-full w-14 h-14 flex items-center justify-center shadow-lg">
                      <span className="text-2xl font-bold">{quantity}</span>
                    </div>
                  )}
                </div>
                <div className="p-4">
                  <h3 className="font-semibold text-foreground text-xl mb-2 text-balance leading-tight">{item.name}</h3>
                  <p className="text-3xl font-bold text-primary mb-3">€{item.price.toFixed(2)}</p>

                  {quantity > 0 ? (
                    <div className="flex items-center justify-between gap-3" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => onUpdateQuantity(item.id, quantity - 1)}
                        className="h-16 w-16 rounded-full shrink-0 hover:bg-primary hover:text-primary-foreground hover:border-primary"
                      >
                        <Minus className="w-8 h-8" />
                      </Button>
                      <span className="text-3xl font-bold text-foreground min-w-[3ch] text-center">{quantity}</span>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => onUpdateQuantity(item.id, quantity + 1)}
                        className="h-16 w-16 rounded-full shrink-0 hover:bg-primary hover:text-primary-foreground hover:border-primary"
                      >
                        <Plus className="w-8 h-8" />
                      </Button>
                    </div>
                  ) : (
                    <Button
                      onClick={(e) => {
                        e.stopPropagation()
                        onAddToOrder(item)
                      }}
                      className="w-full h-16 text-xl font-semibold bg-primary hover:bg-primary/90"
                    >
                      <Plus className="w-7 h-7 mr-2" />
                      Añadir
                    </Button>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      </div>
    </div>
  )
}
