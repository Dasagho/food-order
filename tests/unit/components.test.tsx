import { describe, it, expect, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { makeItem, makeOrder, loadStorage, seedLegacyOrders } from "./helpers";

const plusBtn = (root: HTMLElement) =>
  root.querySelector("svg.lucide-plus")!.closest("button") as HTMLButtonElement;

describe("FloatingOrderButton", () => {
  it("no se muestra sin artículos", async () => {
    const { FloatingOrderButton } = await import("@/components/floating-order-button");
    const { container } = render(<FloatingOrderButton items={[]} onClick={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("muestra cantidad total y precio total", async () => {
    const { FloatingOrderButton } = await import("@/components/floating-order-button");
    const onClick = vi.fn();
    render(
      <FloatingOrderButton
        items={[makeItem({ quantity: 2, price: 4.5 }), makeItem({ id: "2", quantity: 1, price: 3 })]}
        onClick={onClick}
      />,
    );
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("€12.00")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalled();
  });
});

describe("OrderConfirmationModal", () => {
  async function setup(items = [makeItem({ quantity: 2, price: 4.5 })]) {
    const { OrderConfirmationModal } = await import("@/components/order-confirmation-modal");
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<OrderConfirmationModal isOpen items={items} onConfirm={onConfirm} onClose={onClose} />);
    return { onConfirm, onClose };
  }

  it("no renderiza nada si está cerrado", async () => {
    const { OrderConfirmationModal } = await import("@/components/order-confirmation-modal");
    const { container } = render(
      <OrderConfirmationModal isOpen={false} items={[]} onConfirm={() => {}} onClose={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("confirma con efectivo por defecto y los items recibidos", async () => {
    const { onConfirm } = await setup();
    await userEvent.click(screen.getByRole("button", { name: /Confirmar Pedido/ }));
    expect(onConfirm).toHaveBeenCalledWith("efectivo", [expect.objectContaining({ quantity: 2, price: 4.5 })]);
  });

  it.each([["Tarjeta", "tarjeta"], ["Bizum", "bizum"], ["Efectivo", "efectivo"]])(
    "permite elegir método de pago %s",
    async (label, value) => {
      const { onConfirm } = await setup();
      await userEvent.click(screen.getByRole("button", { name: label }));
      await userEvent.click(screen.getByRole("button", { name: /Confirmar Pedido/ }));
      expect(onConfirm.mock.calls[0][0]).toBe(value);
    },
  );

  it("editar el precio recalcula el total y se envía modificado", async () => {
    const { onConfirm } = await setup();
    const input = screen.getByRole("spinbutton");
    await userEvent.clear(input);
    await userEvent.type(input, "5");
    expect(screen.getAllByText("€10.00").length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole("button", { name: /Confirmar Pedido/ }));
    expect(onConfirm.mock.calls[0][1][0].price).toBe(5);
  });

  it("Cancelar y la X invocan onClose", async () => {
    const { onClose } = await setup();
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await userEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("Home: flujo de crear pedido", () => {
  async function renderHome() {
    const { default: Home } = await import("@/Home");
    return render(
      <MemoryRouter>
        <Home />
      </MemoryRouter>,
    );
  }

  it("muestra el menú por defecto y permite buscar", async () => {
    await renderHome();
    expect(await screen.findByText("Paella Valenciana")).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText("Buscar platos..."), "zzzzz");
    expect(await screen.findByText("No se encontraron platos")).toBeInTheDocument();
  });

  it("añadir plato → confirmar → el pedido queda guardado con el número correcto", async () => {
    await renderHome();
    await screen.findByText("Paella Valenciana");

    await userEvent.click(screen.getAllByRole("button", { name: /Ración Completa/ })[0]);
    await userEvent.click(await screen.findByRole("button", { name: /Ver pedido/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Tarjeta" }));
    await userEvent.click(screen.getByRole("button", { name: /Confirmar Pedido/ }));

    const { orders } = await loadStorage();
    await waitFor(async () => expect(await orders.getOrders()).toHaveLength(1));
    const [o] = await orders.getOrders();
    expect(o).toMatchObject({ orderNumber: 1, status: "completado", paymentMethod: "tarjeta" });
    expect(o.items[0]).toMatchObject({ quantity: 1, name: "Paella Valenciana" });
    expect(o.total).toBeCloseTo(4.5);
    // el modal se cierra y el carrito se vacía
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Ver pedido/ })).not.toBeInTheDocument();
  });

  it("el segundo pedido recibe el número siguiente", async () => {
    seedLegacyOrders([makeOrder({ id: "prev", orderNumber: 41 })]);
    await renderHome();
    await screen.findByText("Paella Valenciana");
    await userEvent.click(screen.getAllByRole("button", { name: /Ración Completa/ })[0]);
    await userEvent.click(await screen.findByRole("button", { name: /Ver pedido/ }));
    await userEvent.click(screen.getByRole("button", { name: /Confirmar Pedido/ }));
    const { orders } = await loadStorage();
    await waitFor(async () => expect(await orders.getOrders()).toHaveLength(2));
    expect((await orders.getOrders())[0].orderNumber).toBe(42);
  });
});

describe("PedidosPage", () => {
  const today = () => new Date();
  async function renderPedidos() {
    const { default: Page } = await import("@/pedidos/page");
    return render(
      <MemoryRouter>
        <Page />
      </MemoryRouter>,
    );
  }

  it("lista solo los pedidos de hoy y el contador es correcto", async () => {
    seedLegacyOrders([
      makeOrder({ id: "t2", orderNumber: 2, date: today() }),
      makeOrder({ id: "t1", orderNumber: 1, date: today() }),
      makeOrder({ id: "old", orderNumber: 99, date: new Date("2020-01-01T12:00:00Z") }),
    ]);
    await renderPedidos();
    expect(await screen.findByText("Pedido #2")).toBeInTheDocument();
    expect(screen.getByText("Pedido #1")).toBeInTheDocument();
    expect(screen.queryByText("Pedido #99")).not.toBeInTheDocument();
    expect(screen.getByText(/2\s+pedidos/)).toBeInTheDocument();
  });

  it("sin pedidos muestra el estado vacío", async () => {
    await renderPedidos();
    expect(await screen.findByText("No hay pedidos en esta fecha")).toBeInTheDocument();
  });

  it("eliminar pedido pide confirmación y lo borra", async () => {
    seedLegacyOrders([makeOrder({ id: "a", orderNumber: 1, date: today() })]);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await renderPedidos();
    const title = await screen.findByText("Pedido #1");
    const card = title.closest("div.p-6") as HTMLElement;
    const buttons = within(card).getAllByRole("button");
    await userEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(screen.queryByText("Pedido #1")).not.toBeInTheDocument());
    const { orders } = await loadStorage();
    expect(await orders.getOrders()).toEqual([]);
  });

  it("si se cancela la confirmación NO se borra", async () => {
    seedLegacyOrders([makeOrder({ id: "a", orderNumber: 1, date: today() })]);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    await renderPedidos();
    const title = await screen.findByText("Pedido #1");
    const buttons = within(title.closest("div.p-6") as HTMLElement).getAllByRole("button");
    await userEvent.click(buttons[buttons.length - 1]);
    expect(screen.getByText("Pedido #1")).toBeInTheDocument();
    const { orders } = await loadStorage();
    expect(await orders.getOrders()).toHaveLength(1);
  });

  it("cambiar el estado desde el detalle lo persiste y se refleja en la lista", async () => {
    seedLegacyOrders([makeOrder({ id: "a", orderNumber: 1, date: today(), status: "completado" })]);
    await renderPedidos();
    await userEvent.click(await screen.findByRole("button", { name: /Editar Pedido/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Cancelado" }));
    await waitFor(() => expect(screen.getByText("Cancelado")).toBeInTheDocument());
    const { orders } = await loadStorage();
    expect((await orders.getOrders())[0].status).toBe("cancelado");
  });

  it("editar cantidades desde el detalle recalcula y persiste el total", async () => {
    seedLegacyOrders([
      makeOrder({ id: "a", orderNumber: 1, date: today(), items: [makeItem({ price: 4.5, quantity: 1 })] }),
    ]);
    const { container } = await renderPedidos();
    await userEvent.click(await screen.findByRole("button", { name: /Editar Pedido/ }));
    // dentro del modal hay otro botón "Editar Pedido"
    const editBtns = screen.getAllByRole("button", { name: /Editar Pedido/ });
    await userEvent.click(editBtns[editBtns.length - 1]);
    await userEvent.click(plusBtn(container.ownerDocument.body));
    await userEvent.click(screen.getByRole("button", { name: /Guardar Cambios/ }));
    const { orders } = await loadStorage();
    await waitFor(async () => expect((await orders.getOrders())[0].total).toBeCloseTo(9));
    expect((await orders.getOrders())[0].items[0].quantity).toBe(2);
  });

  it("'Ver Resumen del Día' muestra el resumen de ventas", async () => {
    seedLegacyOrders([makeOrder({ id: "a", orderNumber: 1, date: today() })]);
    await renderPedidos();
    await userEvent.click(await screen.findByRole("button", { name: "Ver Resumen del Día" }));
    expect(await screen.findByRole("button", { name: "Ver Pedidos" })).toBeInTheDocument();
  });
});
