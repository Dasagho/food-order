import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { OrderItem, MenuCategory, MenuItem } from "@/types/order";
import { Plus, Minus } from "lucide-react";
import { getProducts, getCategories } from "@/lib/product-storage";

interface MenuGridProps {
  onAddToOrder: (item: OrderItem) => void;
  orderItems: OrderItem[];
  onUpdateQuantity: (
    id: string,
    quantity: number,
    isHalfPortion?: boolean,
  ) => void;
  onAddHalfPortion: (item: OrderItem) => void;
}

export function MenuGrid({
  onAddToOrder,
  orderItems,
  onUpdateQuantity,
  onAddHalfPortion,
}: MenuGridProps) {
  const [selectedCategory, setSelectedCategory] = useState<
    MenuCategory | "all"
  >("all");
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<
    Array<{ value: MenuCategory | "all"; label: string }>
  >([{ value: "all", label: "Todos" }]);

  useEffect(() => {
    const loadedProducts = getProducts();
    const loadedCategories = getCategories();

    setMenuItems(loadedProducts);

    const categoryOrder: MenuCategory[] = [
      "entrantes",
      "arroces",
      "principales",
      "bebidas",
      "postres",
    ];
    const sortedCategories = loadedCategories.sort((a, b) => {
      const indexA = categoryOrder.indexOf(a.id);
      const indexB = categoryOrder.indexOf(b.id);
      return indexA - indexB;
    });

    setCategories([
      { value: "all", label: "Todos" },
      ...sortedCategories.map((cat) => ({ value: cat.id, label: cat.name })),
    ]);
  }, []);

  const getItemQuantity = (itemId: string, isHalf = false) => {
    const orderItem = orderItems.find(
      (item) => item.id === itemId && item.isHalfPortion === isHalf,
    );
    return orderItem?.quantity || 0;
  };

  const filteredItems =
    selectedCategory === "all"
      ? menuItems
      : menuItems.filter((item) => item.category === selectedCategory);

  return (
    <div className="flex flex-col h-full">
      <header className="border-b border-border bg-card px-6 py-6">
        <h1 className="text-4xl font-semibold text-foreground">Menú</h1>
        <p className="text-lg text-muted-foreground mt-2">
          Selecciona los platos para tu pedido
        </p>
      </header>

      <div className="border-b border-border bg-card px-6 py-4 overflow-x-auto">
        <div className="flex gap-3 min-w-max">
          {categories.map((category) => (
            <Button
              key={category.value}
              variant={
                selectedCategory === category.value ? "default" : "outline"
              }
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
            const fullQuantity = getItemQuantity(item.id, false);
            const halfQuantity = getItemQuantity(item.id, true);
            const totalQuantity = fullQuantity + halfQuantity;
            const isRacionType = item.portionType === "racion";

            return (
              <Card
                key={item.id}
                className="overflow-hidden hover:shadow-xl hover:scale-[1.02] transition-all"
              >
                <div className="aspect-square bg-secondary relative overflow-hidden">
                  <img
                    src={item.image || "/placeholder.svg"}
                    alt={item.name}
                    className="w-full h-full object-cover"
                  />
                  {totalQuantity > 0 && (
                    <div className="absolute top-3 right-3 bg-accent text-accent-foreground rounded-full w-14 h-14 flex items-center justify-center shadow-lg">
                      <span className="text-2xl font-bold">
                        {totalQuantity}
                      </span>
                    </div>
                  )}
                </div>
                <div className="p-4">
                  <h3 className="font-semibold text-foreground text-xl mb-2 text-balance leading-tight">
                    {item.name}
                  </h3>
                  <div className="mb-3">
                    <p className="text-3xl font-bold text-primary">
                      €{item.price.toFixed(2)}
                    </p>
                    {isRacionType && item.halfPortionPrice && (
                      <p className="text-lg text-muted-foreground">
                        Media: €{item.halfPortionPrice.toFixed(2)}
                      </p>
                    )}
                  </div>

                  {isRacionType ? (
                    <div
                      className="space-y-3"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {/* Botón para ración completa */}
                      <div className="flex items-center gap-2">
                        {fullQuantity > 0 ? (
                          <>
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() =>
                                onUpdateQuantity(
                                  item.id,
                                  fullQuantity - 1,
                                  false,
                                )
                              }
                              className="h-12 w-12 rounded-full shrink-0 hover:bg-primary hover:text-primary-foreground hover:border-primary"
                            >
                              <Minus className="w-6 h-6" />
                            </Button>
                            <span className="text-xl font-bold text-foreground min-w-[2ch] text-center">
                              {fullQuantity}
                            </span>
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() =>
                                onUpdateQuantity(
                                  item.id,
                                  fullQuantity + 1,
                                  false,
                                )
                              }
                              className="h-12 w-12 rounded-full shrink-0 hover:bg-primary hover:text-primary-foreground hover:border-primary"
                            >
                              <Plus className="w-6 h-6" />
                            </Button>
                            <span className="text-base text-muted-foreground ml-2">
                              Completa
                            </span>
                          </>
                        ) : (
                          <Button
                            onClick={() =>
                              onAddToOrder({
                                ...item,
                                quantity: 1,
                                isHalfPortion: false,
                              })
                            }
                            className="w-full h-12 text-lg font-semibold bg-primary hover:bg-primary/90"
                          >
                            <Plus className="w-5 h-5 mr-2" />
                            Ración Completa
                          </Button>
                        )}
                      </div>

                      {/* Botón para media ración */}
                      <div className="flex items-center gap-2">
                        {halfQuantity > 0 ? (
                          <>
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() =>
                                onUpdateQuantity(
                                  item.id,
                                  halfQuantity - 1,
                                  true,
                                )
                              }
                              className="h-12 w-12 rounded-full shrink-0 hover:bg-primary hover:text-primary-foreground hover:border-primary"
                            >
                              <Minus className="w-6 h-6" />
                            </Button>
                            <span className="text-xl font-bold text-foreground min-w-[2ch] text-center">
                              {halfQuantity}
                            </span>
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() =>
                                onUpdateQuantity(
                                  item.id,
                                  halfQuantity + 1,
                                  true,
                                )
                              }
                              className="h-12 w-12 rounded-full shrink-0 hover:bg-primary hover:text-primary-foreground hover:border-primary"
                            >
                              <Plus className="w-6 h-6" />
                            </Button>
                            <span className="text-base text-muted-foreground ml-2">
                              Media
                            </span>
                          </>
                        ) : (
                          <Button
                            onClick={() =>
                              onAddHalfPortion({
                                ...item,
                                quantity: 1,
                                isHalfPortion: true,
                              })
                            }
                            variant="outline"
                            className="w-full h-12 text-lg font-semibold hover:bg-primary hover:text-primary-foreground"
                          >
                            <Plus className="w-5 h-5 mr-2" />
                            Media Ración
                          </Button>
                        )}
                      </div>
                    </div>
                  ) : (
                    // Platos por unidades (comportamiento original)
                    <div onClick={(e) => e.stopPropagation()}>
                      {fullQuantity > 0 ? (
                        <div className="flex items-center justify-between gap-3">
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() =>
                              onUpdateQuantity(item.id, fullQuantity - 1, false)
                            }
                            className="h-16 w-16 rounded-full shrink-0 hover:bg-primary hover:text-primary-foreground hover:border-primary"
                          >
                            <Minus className="w-8 h-8" />
                          </Button>
                          <span className="text-3xl font-bold text-foreground min-w-[3ch] text-center">
                            {fullQuantity}
                          </span>
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() =>
                              onUpdateQuantity(item.id, fullQuantity + 1, false)
                            }
                            className="h-16 w-16 rounded-full shrink-0 hover:bg-primary hover:text-primary-foreground hover:border-primary"
                          >
                            <Plus className="w-8 h-8" />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          onClick={() =>
                            onAddToOrder({
                              ...item,
                              quantity: 1,
                              isHalfPortion: false,
                            })
                          }
                          className="w-full h-16 text-xl font-semibold bg-primary hover:bg-primary/90"
                        >
                          <Plus className="w-7 h-7 mr-2" />
                          Añadir
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
