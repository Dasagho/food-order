import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { makeItem, makeOrder } from "./helpers";

const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };
beforeEach(() => {
  Object.values(toast).forEach((f) => f.mockReset());
  vi.doMock("sonner", () => ({ toast, Toaster: () => null }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const boom = () => Promise.reject(new Error("QuotaExceededError"));

describe("fallos de escritura: el usuario siempre debe enterarse", () => {
  it("Home: si no se puede guardar el pedido, avisa y conserva el carrito", async () => {
    const real = await vi.importActual<typeof import("@/lib/order-storage")>("@/lib/order-storage");
    vi.doMock("@/lib/order-storage", () => ({ ...real, saveOrder: vi.fn(boom) }));
    const { default: Home } = await import("@/Home");
    render(<MemoryRouter><Home /></MemoryRouter>);
    await screen.findByText("Paella Valenciana");
    await userEvent.click(screen.getAllByRole("button", { name: /Ración Completa/ })[0]);
    await userEvent.click(await screen.findByRole("button", { name: /Ver pedido/ }));
    await userEvent.click(screen.getByRole("button", { name: /Confirmar Pedido/ }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error.mock.calls[0][0]).toMatch(/No se pudo guardar el pedido/);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
    // el pedido NO se pierde: el modal sigue abierto con los artículos
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Confirmar Pedido/ })).toBeInTheDocument();
  });

  it("Home: si falla getNextOrderNumber también avisa", async () => {
    const real = await vi.importActual<typeof import("@/lib/order-storage")>("@/lib/order-storage");
    vi.doMock("@/lib/order-storage", () => ({ ...real, getNextOrderNumber: vi.fn(boom) }));
    const { default: Home } = await import("@/Home");
    render(<MemoryRouter><Home /></MemoryRouter>);
    await screen.findByText("Paella Valenciana");
    await userEvent.click(screen.getAllByRole("button", { name: /Ración Completa/ })[0]);
    await userEvent.click(await screen.findByRole("button", { name: /Ver pedido/ }));
    await userEvent.click(screen.getByRole("button", { name: /Confirmar Pedido/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("Pedidos: si falla el borrado avisa y el pedido sigue en la lista", async () => {
    const real = await vi.importActual<typeof import("@/lib/order-storage")>("@/lib/order-storage");
    vi.doMock("@/lib/order-storage", () => ({
      ...real,
      getOrders: vi.fn().mockResolvedValue([makeOrder({ id: "a", orderNumber: 1, date: new Date() })]),
      deleteOrder: vi.fn(boom),
    }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { default: Page } = await import("@/pedidos/page");
    render(<MemoryRouter><Page /></MemoryRouter>);
    await userEvent.click(await screen.findByRole("button", { name: "Eliminar pedido #1" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByText("Pedido #1")).toBeInTheDocument();
  });

  it("Pedidos: si falla la carga avisa (no muestra un falso 'no hay pedidos' en silencio)", async () => {
    const real = await vi.importActual<typeof import("@/lib/order-storage")>("@/lib/order-storage");
    vi.doMock("@/lib/order-storage", () => ({ ...real, getOrders: vi.fn(boom) }));
    const { default: Page } = await import("@/pedidos/page");
    render(<MemoryRouter><Page /></MemoryRouter>);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error.mock.calls[0][0]).toMatch(/cargar/i);
  });

  it("Detalle: si falla el cambio de estado avisa y no cierra el modal", async () => {
    vi.doMock("@/lib/order-storage", () => ({ updateOrderStatus: vi.fn(boom), updateOrder: vi.fn(boom) }));
    const { OrderDetailModal } = await import("@/components/order-detail-modal");
    const onUpdate = vi.fn();
    render(<OrderDetailModal order={makeOrder({ items: [makeItem()] })} onClose={() => {}} onUpdate={onUpdate} />);
    await userEvent.click(screen.getByRole("button", { name: "Cancelado" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("Detalle: si falla guardar los cambios avisa y mantiene la edición", async () => {
    vi.doMock("@/lib/order-storage", () => ({ updateOrderStatus: vi.fn(boom), updateOrder: vi.fn(boom) }));
    const { OrderDetailModal } = await import("@/components/order-detail-modal");
    const onUpdate = vi.fn();
    render(<OrderDetailModal order={makeOrder({ items: [makeItem()] })} onClose={() => {}} onUpdate={onUpdate} />);
    await userEvent.click(screen.getByRole("button", { name: /Editar Pedido/ }));
    await userEvent.click(screen.getByRole("button", { name: /Guardar Cambios/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(onUpdate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Guardar Cambios/ })).toBeInTheDocument();
  });

  it("Admin: si falla guardar un producto avisa y el formulario sigue abierto", async () => {
    const real = await vi.importActual<typeof import("@/lib/product-storage")>("@/lib/product-storage");
    vi.doMock("@/lib/product-storage", () => ({ ...real, saveProduct: vi.fn(boom) }));
    const { default: Admin } = await import("@/admin/page");
    render(<MemoryRouter><Admin /></MemoryRouter>);
    await userEvent.click(await screen.findByRole("button", { name: /Nuevo Producto/ }));
    await userEvent.type(document.querySelector("#name")!, "Tortilla");
    await userEvent.type(document.querySelector("#price")!, "3");
    await userEvent.type(document.querySelector("#image")!, "/x.jpg");
    await userEvent.click(screen.getByRole("button", { name: /Crear Producto/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /Crear Producto/ })).toBeInTheDocument();
  });

  it("Admin: si falla el borrado avisa y el producto sigue", async () => {
    const real = await vi.importActual<typeof import("@/lib/product-storage")>("@/lib/product-storage");
    vi.doMock("@/lib/product-storage", () => ({ ...real, deleteProduct: vi.fn(boom) }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { default: Admin } = await import("@/admin/page");
    render(<MemoryRouter><Admin /></MemoryRouter>);
    await userEvent.click(await screen.findByRole("button", { name: "Eliminar Paella Valenciana" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByRole("heading", { name: "Paella Valenciana" })).toBeInTheDocument();
  });
});
