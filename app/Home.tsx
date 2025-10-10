import { useState } from "react";
import { MenuGrid } from "@/components/menu-grid";
import { OrderConfirmationModal } from "@/components/order-confirmation-modal";
import { FloatingOrderButton } from "@/components/floating-order-button";
import { Button } from "@/components/ui/button";
import { ClipboardList } from "lucide-react";
import type { OrderItem, ConfirmedOrder } from "@/types/order";
import { saveOrder, getNextOrderNumber } from "@/lib/order-storage";
import { useNavigate } from "react-router-dom";

export default function Home() {
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const navigate = useNavigate();
  const addToOrder = (item: OrderItem) => {
    setOrderItems((prev) => {
      const existingItem = prev.find((i) => i.id === item.id);
      if (existingItem) {
        return prev.map((i) =>
          i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i,
        );
      }
      return [...prev, { ...item, quantity: 1 }];
    });
  };

  const updateQuantity = (id: string, quantity: number) => {
    if (quantity <= 0) {
      setOrderItems((prev) => prev.filter((item) => item.id !== id));
    } else {
      setOrderItems((prev) =>
        prev.map((item) => (item.id === id ? { ...item, quantity } : item)),
      );
    }
  };

  const handleFinalizeOrder = () => {
    const total = orderItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    );

    const confirmedOrder: ConfirmedOrder = {
      id: crypto.randomUUID(),
      orderNumber: getNextOrderNumber(),
      items: orderItems,
      total,
      date: new Date(),
      status: "completado",
    };

    saveOrder(confirmedOrder);

    setOrderItems([]);
    setShowConfirmation(false);
  };

  return (
    <main className="min-h-screen bg-background">
      <div className="fixed top-6 right-6 z-40">
        <Button
          size="lg"
          onClick={() => navigate("/pedidos")}
          className="h-16 px-8 text-xl bg-accent hover:bg-accent/90 text-accent-foreground shadow-lg"
        >
          <ClipboardList className="w-8 h-8 mr-3" />
          Ver Pedidos
        </Button>
      </div>

      <MenuGrid
        onAddToOrder={addToOrder}
        orderItems={orderItems}
        onUpdateQuantity={updateQuantity}
      />

      <FloatingOrderButton
        items={orderItems}
        onClick={() => setShowConfirmation(true)}
      />

      <OrderConfirmationModal
        isOpen={showConfirmation}
        onClose={() => setShowConfirmation(false)}
        items={orderItems}
        onConfirm={handleFinalizeOrder}
      />
    </main>
  );
}
