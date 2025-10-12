import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowLeft, Trash2, Edit, Package, Calendar, X } from "lucide-react";
import type { ConfirmedOrder } from "@/types/order";
import { getOrders, deleteOrder } from "@/lib/order-storage";
import { OrderDetailModal } from "@/components/order-detail-modal";
import { DailySalesSummary } from "@/components/daily-sales-summary";
import { DatePicker } from "@/components/date-picker";
import { useNavigate } from "react-router-dom";
import {
  toMadridDateString,
  formatMadridDate,
  getTodayInMadrid,
} from "@/lib/date-utils";

export default function PedidosPage() {
  const [orders, setOrders] = useState<ConfirmedOrder[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<ConfirmedOrder | null>(
    null,
  );
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(
    getTodayInMadrid(),
  );
  const [showSummary, setShowSummary] = useState(false);
  const navigate = useNavigate();
  useEffect(() => {
    setOrders(getOrders());
  }, []);

  const availableDates = useMemo(() => {
    const dates = orders.map((order) => {
      return toMadridDateString(new Date(order.date));
    });
    return Array.from(new Set(dates)).sort((a, b) => b.localeCompare(a));
  }, [orders]);

  const filteredOrders = useMemo(() => {
    if (!selectedDate) return orders;
    const selectedDateString = toMadridDateString(selectedDate);
    return orders.filter((order) => {
      const orderDate = toMadridDateString(new Date(order.date));
      return orderDate === selectedDateString;
    });
  }, [orders, selectedDate]);

  const handleDeleteOrder = (orderId: string) => {
    if (confirm("¿Estás seguro de que quieres eliminar este pedido?")) {
      deleteOrder(orderId);
      setOrders(getOrders());
    }
  };

  const handleEditOrder = (order: ConfirmedOrder) => {
    setSelectedOrder(order);
  };

  const formatDate = (date: Date) => {
    return formatMadridDate(date, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatDateLabel = (dateString: string) => {
    const date = new Date(dateString);
    return formatMadridDate(date, {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const getStatusColor = (status: ConfirmedOrder["status"]) => {
    switch (status) {
      case "completado":
        return "bg-green-500/10 text-green-700 border-green-500/20";
      case "en_proceso":
        return "bg-blue-500/10 text-blue-700 border-blue-500/20";
      case "cancelado":
        return "bg-red-500/10 text-red-700 border-red-500/20";
    }
  };

  const getStatusText = (status: ConfirmedOrder["status"]) => {
    switch (status) {
      case "completado":
        return "Completado";
      case "en_proceso":
        return "En Proceso";
      case "cancelado":
        return "Cancelado";
    }
  };

  return (
    <main className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate("/")}
              className="shrink-0 h-14 w-14"
            >
              <ArrowLeft className="w-8 h-8" />
            </Button>
            <div className="flex-1">
              <h1 className="text-3xl font-bold text-foreground">
                Historial de Pedidos
              </h1>
              <p className="text-lg text-muted-foreground">
                Gestiona tus pedidos realizados
              </p>
            </div>
          </div>
        </div>
      </div>

      {orders.length > 0 && (
        <div className="container mx-auto px-4 py-6">
          <div className="flex flex-wrap gap-4 items-center">
            {/* Selector de fecha */}
            <div className="flex items-center gap-2">
              <Calendar className="w-6 h-6 text-muted-foreground" />
              <DatePicker
                selectedDate={selectedDate}
                onDateChange={setSelectedDate}
                availableDates={availableDates}
                placeholder="Seleccionar las fechas"
              />
              {selectedDate && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setSelectedDate(getTodayInMadrid())}
                  className="h-14 w-14 shrink-0"
                  title="Volver a hoy"
                >
                  <X className="w-6 h-6" />
                </Button>
              )}
            </div>

            {/* Botón de resumen */}
            {selectedDate && (
              <Button
                onClick={() => setShowSummary(!showSummary)}
                className="h-14 text-lg bg-accent hover:bg-accent/90 text-accent-foreground px-6"
              >
                {showSummary ? "Ver Pedidos" : "Ver Resumen del Día"}
              </Button>
            )}

            {/* Contador de pedidos filtrados */}
            <div className="ml-auto text-lg text-muted-foreground">
              {filteredOrders.length}{" "}
              {filteredOrders.length === 1 ? "pedido" : "pedidos"}
            </div>
          </div>
        </div>
      )}

      <div className="container mx-auto px-4 py-6">
        {showSummary && selectedDate ? (
          <DailySalesSummary
            orders={filteredOrders}
            selectedDate={toMadridDateString(selectedDate)}
          />
        ) : filteredOrders.length === 0 ? (
          <Card className="p-12 text-center">
            <div className="flex flex-col items-center gap-4">
              <div className="bg-muted rounded-full p-6">
                <Package className="w-12 h-12 text-muted-foreground" />
              </div>
              <div>
                <h3 className="text-2xl font-semibold text-foreground mb-2">
                  {selectedDate
                    ? "No hay pedidos en esta fecha"
                    : "No hay pedidos"}
                </h3>
                <p className="text-lg text-muted-foreground mb-6">
                  {selectedDate
                    ? "Selecciona otra fecha o elimina el filtro"
                    : "Aún no has realizado ningún pedido"}
                </p>
                {!selectedDate && (
                  <Button
                    onClick={() => navigate("/")}
                    className="bg-accent hover:bg-accent/90 text-accent-foreground h-14 text-lg"
                  >
                    Hacer un Pedido
                  </Button>
                )}
              </div>
            </div>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredOrders.map((order) => (
              <Card
                key={order.id}
                className="p-6 hover:shadow-lg transition-shadow"
              >
                {/* Order Header */}
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-2xl font-bold text-foreground">
                      Pedido #{order.orderNumber}
                    </h3>
                    <p className="text-base text-muted-foreground">
                      {formatDate(new Date(order.date))}
                    </p>
                  </div>
                  <span
                    className={`px-3 py-1 rounded-full text-sm font-semibold border ${getStatusColor(order.status)}`}
                  >
                    {getStatusText(order.status)}
                  </span>
                </div>

                {/* Order Items Summary */}
                <div className="space-y-2 mb-4">
                  {order.items.slice(0, 3).map((item) => (
                    <div
                      key={`${item.id}-${item.isHalfPortion}`}
                      className="flex items-center justify-between text-base"
                    >
                      <span className="text-foreground">
                        {item.quantity}x {item.name}
                        {item.isHalfPortion && " (Media)"}
                      </span>
                      <span className="text-muted-foreground">
                        €{(item.price * item.quantity).toFixed(2)}
                      </span>
                    </div>
                  ))}
                  {order.items.length > 3 && (
                    <p className="text-sm text-muted-foreground">
                      +{order.items.length - 3} artículos más
                    </p>
                  )}
                </div>

                {/* Total */}
                <div className="border-t border-border pt-4 mb-4">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-foreground text-lg">
                      Total
                    </span>
                    <span className="text-2xl font-bold text-primary">
                      €{order.total.toFixed(2)}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => handleEditOrder(order)}
                    className="flex-1 h-12 text-base"
                  >
                    <Edit className="w-6 h-6 mr-2" />
                    Editar Pedido
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => handleDeleteOrder(order.id)}
                    className="h-12 text-destructive hover:text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="w-6 h-6" />
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Order Detail Modal */}
      {selectedOrder && (
        <OrderDetailModal
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onUpdate={() => {
            setOrders(getOrders());
            setSelectedOrder(null);
          }}
        />
      )}
    </main>
  );
}
