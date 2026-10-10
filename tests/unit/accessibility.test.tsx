import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { makeItem, makeOrder, seedLegacyOrders } from "./helpers";

// Los botones de solo icono deben tener nombre accesible.
describe("accesibilidad: botones de solo icono", () => {
  it("menú: +/- de cada plato indican qué plato modifican", async () => {
    const { default: Home } = await import("@/Home");
    render(<MemoryRouter><Home /></MemoryRouter>);
    await screen.findByText("Paella Valenciana");
    await userEvent.click(screen.getAllByRole("button", { name: /Ración Completa/ })[0]);
    expect(await screen.findByRole("button", { name: "Añadir uno más de Paella Valenciana (completa)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quitar uno de Paella Valenciana (completa)" })).toBeInTheDocument();
  });

  it("pedidos: volver, eliminar y cerrar/editar en el detalle", async () => {
    seedLegacyOrders([makeOrder({ id: "a", orderNumber: 7, date: new Date(), items: [makeItem({ name: "Paella" })] })]);
    const { default: Page } = await import("@/pedidos/page");
    render(<MemoryRouter><Page /></MemoryRouter>);
    expect(screen.getByRole("button", { name: "Volver al menú" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Eliminar pedido #7" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Volver a hoy" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Editar Pedido/ }));
    expect(await screen.findByRole("button", { name: "Cerrar ventana" })).toBeInTheDocument();
    const edit = screen.getAllByRole("button", { name: /Editar Pedido/ });
    await userEvent.click(edit[edit.length - 1]);
    expect(screen.getByRole("button", { name: "Añadir una unidad de Paella" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quitar una unidad de Paella" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quitar Paella del pedido" })).toBeInTheDocument();
  });

  it("admin: eliminar y arrastrar indican el producto", async () => {
    const { default: Admin } = await import("@/admin/page");
    render(<MemoryRouter><Admin /></MemoryRouter>);
    expect(await screen.findByRole("button", { name: "Eliminar Paella Valenciana" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Reordenar/ }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Arrastrar Paella Valenciana" })).toBeInTheDocument(),
    );
  });

  it("formulario de producto: cerrar", async () => {
    const { ProductForm } = await import("@/components/product-form");
    render(<ProductForm onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Cerrar formulario" })).toBeInTheDocument();
  });
});
