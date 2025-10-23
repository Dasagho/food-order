import { useState } from "react";
import { MenuGrid } from "@/components/menu-grid";
import { OrderConfirmationModal } from "@/components/order-confirmation-modal";
import { FloatingOrderButton } from "@/components/floating-order-button";
import { ScrollToTopButton } from "@/components/scroll-to-top-button";
import { Button } from "@/components/ui/button";
import { ClipboardList, Settings } from "lucide-react";
import type { OrderItem, ConfirmedOrder } from "@/types/order";
import { saveOrder, getNextOrderNumber } from "@/lib/order-storage";
import { useNavigate } from "react-router-dom";
import { getMadridDate } from "@/lib/date-utils";
import { toast } from "sonner";
import {
  syncOrderToPocketBase,
  isOnline,
  isAuthenticated,
} from "@/lib/pocketbase";
import { AuthButton } from "./components/auth-button";

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

  const handleFinalizeOrder = async (
    paymentMethod: "efectivo" | "tarjeta" | "bizum",
    modifiedItems: OrderItem[],
  ) => {
    const total = modifiedItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    );

    const confirmedOrder: ConfirmedOrder = {
      id: crypto.randomUUID(),
      orderNumber: getNextOrderNumber(),
      items: modifiedItems,
      total,
      date: getMadridDate(),
      status: "completado",
      paymentMethod, // Añadido método de pago
    };

    saveOrder(confirmedOrder);

    if (isOnline() && isAuthenticated()) {
      const synced = await syncOrderToPocketBase(confirmedOrder);
      if (synced) {
        toast.success("Pedido guardado y sincronizado con la nube");
      } else {
        toast.warning("Pedido guardado localmente - No se pudo sincronizar");
      }
    } else {
      toast.info("Pedido guardado localmente - Sin conexión o no autenticado");
    }

    setOrderItems([]);
    setShowConfirmation(false);
  };

  return (
    <main className="min-h-screen bg-background">
      <header className="border-b border-border bg-card px-6 py-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h1 className="text-5xl font-semibold text-foreground">Menú</h1>

          <div className="flex items-center gap-3 flex-wrap">
            <AuthButton />
            <Button
              size="lg"
              onClick={() => navigate("/admin")}
              variant="outline"
              className="h-14 px-6 text-lg"
            >
              <Settings className="w-6 h-6 mr-2" />
              Admin
            </Button>
            <Button
              size="lg"
              onClick={() => navigate("/pedidos")}
              className="h-14 px-6 text-lg bg-accent hover:bg-accent/90 text-accent-foreground"
            >
              <ClipboardList className="w-6 h-6 mr-2" />
              Ver Pedidos
            </Button>
          </div>
        </div>
      </header>

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

      <ScrollToTopButton />

      <OrderConfirmationModal
        isOpen={showConfirmation}
        onClose={() => setShowConfirmation(false)}
        items={orderItems}
        onConfirm={handleFinalizeOrder}
      />
    </main>
  );
}
