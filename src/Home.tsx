import { useState } from "react";
import { MenuGrid } from "@/components/menu-grid";
import { OrderConfirmationModal } from "@/components/order-confirmation-modal";
import { FloatingOrderButton } from "@/components/floating-order-button";
import { Button } from "@/components/ui/button";
import { ClipboardList, Settings } from "lucide-react";
import type { OrderItem, ConfirmedOrder } from "@/types/order";
import { saveOrder, getNextOrderNumber } from "@/lib/order-storage";
import { useNavigate } from "react-router-dom";
import { getMadridDate } from "@/lib/date-utils";

export default function Home() {
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const navigate = useNavigate();

  const addToOrder = (item: OrderItem) => {
    setOrderItems((prev) => {
      const existingItem = prev.find(
        (i) => i.id === item.id && i.isHalfPortion === item.isHalfPortion,
      );
      if (existingItem) {
        return prev.map((i) =>
          i.id === item.id && i.isHalfPortion === item.isHalfPortion
            ? { ...i, quantity: i.quantity + 1 }
            : i,
        );
      }
      return [...prev, { ...item, quantity: 1 }];
    });
  };

  const addHalfPortion = (item: OrderItem) => {
    setOrderItems((prev) => {
      const existingItem = prev.find(
        (i) => i.id === item.id && i.isHalfPortion === true,
      );
      if (existingItem) {
        return prev.map((i) =>
          i.id === item.id && i.isHalfPortion === true
            ? { ...i, quantity: i.quantity + 1 }
            : i,
        );
      }
      return [
        ...prev,
        {
          ...item,
          quantity: 1,
          isHalfPortion: true,
          price: item.halfPortionPrice || item.price,
        },
      ];
    });
  };

  const updateQuantity = (
    id: string,
    quantity: number,
    isHalfPortion = false,
  ) => {
    if (quantity <= 0) {
      setOrderItems((prev) =>
        prev.filter(
          (item) => !(item.id === id && item.isHalfPortion === isHalfPortion),
        ),
      );
    } else {
      setOrderItems((prev) =>
        prev.map((item) =>
          item.id === id && item.isHalfPortion === isHalfPortion
            ? { ...item, quantity }
            : item,
        ),
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
      date: getMadridDate(),
      status: "completado",
    };

    saveOrder(confirmedOrder);

    setOrderItems([]);
    setShowConfirmation(false);
  };

  return (
    <main className="min-h-screen bg-background">
      <div className="fixed top-6 right-6 z-40 flex gap-3">
        <Button
          size="lg"
          onClick={() => navigate("/admin")}
          variant="outline"
          className="h-16 px-8 text-xl shadow-lg"
        >
          <Settings className="w-8 h-8 mr-3" />
          Admin
        </Button>
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
        onAddHalfPortion={addHalfPortion}
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
