import { Card } from "@/components/ui/card";
import { TrendingUp, Package, DollarSign } from "lucide-react";
import type { ConfirmedOrder } from "@/types/order";

interface DailySalesSummaryProps {
  orders: ConfirmedOrder[];
  selectedDate: string;
}

export function DailySalesSummary({
  orders,
  selectedDate,
}: DailySalesSummaryProps) {
  // Calcular resumen de ventas
  const totalSales = orders.reduce((sum, order) => sum + order.total, 0);
  const totalOrders = orders.length;

  // Agrupar productos vendidos
  const productSummary = orders.reduce(
    (acc, order) => {
      order.items.forEach((item) => {
        const key = `${item.name}${item.isHalfPortion ? " (Media)" : ""}`;
        if (!acc[key]) {
          acc[key] = {
            name: key,
            quantity: 0,
            total: 0,
          };
        }
        acc[key].quantity += item.quantity;
        acc[key].total += item.price * item.quantity;
      });
      return acc;
    },
    {} as Record<string, { name: string; quantity: number; total: number }>,
  );

  const productList = Object.values(productSummary).sort(
    (a, b) => b.total - a.total,
  );

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat("es-ES", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(date);
  };

  if (orders.length === 0) {
    return (
      <Card className="p-8 text-center">
        <div className="flex flex-col items-center gap-3">
          <div className="bg-muted rounded-full p-4">
            <Package className="w-10 h-10 text-muted-foreground" />
          </div>
          <div>
            <h3 className="text-xl font-semibold text-foreground mb-1">
              No hay ventas
            </h3>
            <p className="text-base text-muted-foreground">
              No se realizaron pedidos en esta fecha
            </p>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-foreground mb-1">
          Resumen de Ventas
        </h2>
        <p className="text-lg text-muted-foreground capitalize">
          {formatDate(selectedDate)}
        </p>
      </div>

      {/* Estadísticas principales */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-accent/10 rounded-lg p-4 border border-accent/20">
          <div className="flex items-center gap-3 mb-2">
            <div className="bg-accent/20 rounded-full p-2">
              <Package className="w-6 h-6 text-accent" />
            </div>
            <span className="text-base text-muted-foreground">
              Total Pedidos
            </span>
          </div>
          <p className="text-3xl font-bold text-foreground">{totalOrders}</p>
        </div>

        <div className="bg-primary/10 rounded-lg p-4 border border-primary/20">
          <div className="flex items-center gap-3 mb-2">
            <div className="bg-primary/20 rounded-full p-2">
              <TrendingUp className="w-6 h-6 text-primary" />
            </div>
            <span className="text-base text-muted-foreground">
              Total Productos
            </span>
          </div>
          <p className="text-3xl font-bold text-foreground">
            {orders.reduce(
              (sum, order) =>
                sum + order.items.reduce((s, item) => s + item.quantity, 0),
              0,
            )}
          </p>
        </div>

        <div className="bg-green-500/10 rounded-lg p-4 border border-green-500/20">
          <div className="flex items-center gap-3 mb-2">
            <div className="bg-green-500/20 rounded-full p-2">
              <DollarSign className="w-6 h-6 text-green-600" />
            </div>
            <span className="text-base text-muted-foreground">
              Total Ventas
            </span>
          </div>
          <p className="text-3xl font-bold text-green-600">
            €{totalSales.toFixed(2)}
          </p>
        </div>
      </div>

      {/* Desglose por productos */}
      <div>
        <h3 className="text-xl font-semibold text-foreground mb-4">
          Productos Vendidos
        </h3>
        <div className="space-y-3 max-h-96 overflow-y-auto">
          {productList.map((product, index) => (
            <div
              key={index}
              className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
            >
              <div className="flex-1">
                <p className="text-lg font-medium text-foreground">
                  {product.name}
                </p>
                <p className="text-base text-muted-foreground">
                  {product.quantity} unidades
                </p>
              </div>
              <p className="text-xl font-bold text-primary">
                €{product.total.toFixed(2)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
