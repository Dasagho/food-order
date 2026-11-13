import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { DailySalesSummary } from "@/components/daily-sales-summary";
import { makeItem, makeOrder } from "./helpers";

const paella = (q: number) => makeItem({ name: "Paella", price: 4.5, quantity: q });
const arroz = (q: number) => makeItem({ id: "2", name: "Arroz", price: 10, quantity: q });

describe("DailySalesSummary: pedidos cancelados", () => {
  const orders = [
    makeOrder({ id: "a", status: "completado", items: [paella(2)] }), // 9.00
    makeOrder({ id: "b", status: "en_proceso", items: [paella(1)] }), // 4.50
    makeOrder({ id: "c", status: "cancelado", items: [arroz(10)] }), // 100.00 (NO cuenta)
  ];

  const stat = (label: string) =>
    screen.getByText(label).closest("div.rounded-lg")!.querySelector("p")!.textContent;

  it("el total de ventas no incluye pedidos cancelados", () => {
    render(<DailySalesSummary orders={orders} selectedDate="2025-03-10" />);
    expect(stat("Total Ventas")).toBe("€13.50");
  });

  it("el total de pedidos y de productos no incluye cancelados", () => {
    render(<DailySalesSummary orders={orders} selectedDate="2025-03-10" />);
    expect(stat("Total Pedidos")).toBe("2");
    expect(stat("Total Productos")).toBe("3");
  });

  it("los productos de un pedido cancelado no aparecen en el desglose", () => {
    render(<DailySalesSummary orders={orders} selectedDate="2025-03-10" />);
    expect(screen.getByText("Paella")).toBeInTheDocument();
    expect(screen.queryByText("Arroz")).not.toBeInTheDocument();
  });

  it("si todos los pedidos están cancelados se muestra 'No hay ventas'", () => {
    render(
      <DailySalesSummary
        orders={[makeOrder({ status: "cancelado", items: [arroz(1)] })]}
        selectedDate="2025-03-10"
      />,
    );
    expect(screen.getByText("No hay ventas")).toBeInTheDocument();
  });

  it("sin cancelados el comportamiento no cambia", () => {
    render(<DailySalesSummary orders={orders.slice(0, 2)} selectedDate="2025-03-10" />);
    expect(stat("Total Ventas")).toBe("€13.50");
    expect(stat("Total Pedidos")).toBe("2");
  });
});
