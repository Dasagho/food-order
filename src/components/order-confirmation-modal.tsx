import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { OrderItem } from "@/types/order";
import {
  X,
  CheckCircle2,
  ShoppingBag,
  Banknote,
  CreditCard,
  Smartphone,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Label } from "./ui/label";
import { Input } from "./ui/input";

interface OrderConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: OrderItem[];
  onConfirm: (
    paymentMethod: "efectivo" | "tarjeta" | "bizum",
    modifiedItems: OrderItem[],
  ) => void;
}

export function OrderConfirmationModal({
  isOpen,
  onClose,
  items,
  onConfirm,
}: OrderConfirmationModalProps) {
  const [editableItems, setEditableItems] = useState<OrderItem[]>(items);
  const [paymentMethod, setPaymentMethod] = useState<
    "efectivo" | "tarjeta" | "bizum"
  >("efectivo");

  useEffect(() => {
    setEditableItems(items);
  }, [items]);

  if (!isOpen) return null;

  const total = editableItems.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0,
  );
  const itemCount = editableItems.reduce((sum, item) => sum + item.quantity, 0);

  const updateItemPrice = (itemId: string, newPrice: number) => {
    setEditableItems((prev) =>
      prev.map((item) =>
        item.id === itemId ? { ...item, price: Math.max(0, newPrice) } : item,
      ),
    );
  };

  const handleConfirm = () => {
    onConfirm(paymentMethod, editableItems);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <Card className="w-[98vw] max-w-[1600px] h-[95vh] flex flex-col bg-card">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="flex items-center gap-2">
            <div className="bg-accent text-accent-foreground rounded-full p-2">
              <ShoppingBag className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-foreground">
                Confirmar Pedido
              </h2>
              <p className="text-base text-muted-foreground">
                Revisa tu pedido antes de confirmar
              </p>
            </div>
          </div>
          <Button
            aria-label="Cerrar"
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="shrink-0 h-10 w-10"
          >
            <X className="w-6 h-6" />
          </Button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden p-4">
          {/* Force 2 columns on lg+ screens, stack on small */}
          <div className="flex flex-col lg:flex-row gap-6 h-full">
            {/* LEFT: Artículos del pedido */}
            <section className="min-h-0 min-w-0 lg:basis-7/12 lg:pr-2 flex flex-col">
              <h3 className="text-xl font-semibold text-foreground mb-3">
                Artículos del pedido
              </h3>

              {/* Scroll only the list, not the whole modal */}
              <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
                {editableItems.map((item) => (
                  <Card key={item.id} className="p-3 bg-background">
                    <div className="flex items-center gap-3">
                      <img
                        src={item.image || "/placeholder.svg"}
                        alt={item.name}
                        className="w-16 h-16 rounded-lg object-cover bg-secondary shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <h4 className="font-semibold text-foreground text-xl mb-1 truncate">
                          {item.name}
                        </h4>
                        <p className="text-muted-foreground text-base">
                          Cantidad: {item.quantity}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <Label className="text-base shrink-0">Precio:</Label>
                          <Input
                            inputMode="decimal"
                            type="number"
                            step="0.05"
                            min="0"
                            value={Number.isFinite(item.price) ? item.price : 0}
                            onChange={(e) =>
                              updateItemPrice(
                                item.id,
                                Number.parseFloat(e.target.value) || 0,
                              )
                            }
                            className="w-24 h-9 text-base"
                          />
                          <span className="text-base">€</span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-2xl font-bold text-primary">
                          €{(item.price * item.quantity).toFixed(2)}
                        </p>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </section>

            {/* RIGHT: Método de pago + resumen + acciones */}
            <aside className="min-h-0 min-w-0 lg:basis-5/12 lg:pl-2 flex flex-col overflow-hidden">
              {/* Método de Pago */}
              <div className="mb-2">
                <Label className="text-xl font-semibold text-foreground mb-2 block">
                  Método de Pago
                </Label>
                <div className="grid grid-cols-3 gap-2">
                  <Button
                    variant={
                      paymentMethod === "efectivo" ? "default" : "outline"
                    }
                    size="lg"
                    onClick={() => setPaymentMethod("efectivo")}
                    className="h-14 flex items-center justify-start gap-3 px-4"
                  >
                    <Banknote className="w-6 h-6" />
                    <span className="text-lg font-semibold">Efectivo</span>
                  </Button>
                  <Button
                    variant={
                      paymentMethod === "tarjeta" ? "default" : "outline"
                    }
                    size="lg"
                    onClick={() => setPaymentMethod("tarjeta")}
                    className="h-14 flex items-center justify-start gap-3 px-4"
                  >
                    <CreditCard className="w-6 h-6" />
                    <span className="text-lg font-semibold">Tarjeta</span>
                  </Button>
                  <Button
                    variant={paymentMethod === "bizum" ? "default" : "outline"}
                    size="lg"
                    onClick={() => setPaymentMethod("bizum")}
                    className="h-14 flex items-center justify-start gap-3 px-4"
                  >
                    <Smartphone className="w-6 h-6" />
                    <span className="text-lg font-semibold">Bizum</span>
                  </Button>
                </div>
              </div>

              {/* Resumen */}
              <Card className="p-4 bg-muted/50">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-lg">
                    <span className="text-muted-foreground">Artículos</span>
                    <span className="font-semibold text-foreground">
                      {itemCount}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-lg">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span className="font-semibold text-foreground">
                      €{total.toFixed(2)}
                    </span>
                  </div>
                  <div className="border-t border-border pt-2 mt-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xl font-bold text-foreground">
                        Total
                      </span>
                      <span className="text-3xl font-bold text-primary">
                        €{total.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              </Card>

              {/* Actions anchored at bottom */}
              <div className="mt-auto pt-3 flex flex-col gap-2">
                <Button
                  size="lg"
                  onClick={handleConfirm}
                  className="w-full h-14 text-lg font-semibold bg-accent hover:bg-accent/90 text-accent-foreground"
                >
                  <CheckCircle2 className="w-6 h-6 mr-2" />
                  Confirmar Pedido
                </Button>
                <Button
                  variant="outline"
                  size="lg"
                  onClick={onClose}
                  className="w-full h-14 text-lg font-semibold bg-transparent"
                >
                  Cancelar
                </Button>
              </div>
            </aside>
          </div>
        </div>
      </Card>
    </div>
  );
}
