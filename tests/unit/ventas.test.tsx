import { describe, it, expect } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { boot } from "./helpers";
import { renderApp } from "./render";

type App = Awaited<ReturnType<typeof boot>>;
const rowOf = (id: string) =>
  waitFor(() => {
    const r = document.querySelector(`[data-order="${id}"]`) as HTMLElement | null;
    expect(r).not.toBeNull();
    return r as HTMLElement;
  });
const dialog = () => screen.getAllByRole("dialog").at(-1)!;

async function seed(app: App) {
  const { api } = await import("@/lib/api");
  const mk = async (over: Record<string, unknown>) => {
    const body = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      status: "completado",
      paymentMethod: "efectivo",
      items: [{ productId: "1", name: "Paella Valenciana", unitPrice: 4.5, listPrice: 4.5, quantity: 2, half: false }],
      ...over,
    };
    await api.orders.create(body as any);
    return body.id as string;
  };
  return {
    done: await mk({}), // 9,00 efectivo
    card: await mk({ paymentMethod: "tarjeta", items: [{ productId: "4", name: "Lata de refresco", unitPrice: 2, listPrice: 2, quantity: 1, half: false }] }), // 2,00
    void: await mk({ status: "cancelado", paymentMethod: "bizum", items: [{ productId: "3", name: "Croqueta de jamón", unitPrice: 1.5, listPrice: 1.5, quantity: 2, half: false }] }), // 3,00 anulado
    yesterday: await mk({ createdAt: new Date(Date.now() - 36 * 3600e3).toISOString() }),
  };
}

describe("Ventas: resumen y lista del día", () => {
  it("el resumen sale de /reports/daily: los anulados no suman, desglose por pago y línea informativa", async () => {
    const app = await boot();
    await seed(app);
    await renderApp("/ventas");
    const stats = await screen.findByRole("region", { name: "Resumen del día" });
    expect(within(stats).getByText("Total del día").parentElement).toHaveTextContent(/11,00/); // 9 + 2, sin los 3 anulados
    expect(within(stats).getByText("Efectivo").parentElement).toHaveTextContent(/9,00/);
    expect(within(stats).getByText("Tarjeta").parentElement).toHaveTextContent(/2,00/);
    expect(within(stats).getByText("Bizum").parentElement).toHaveTextContent(/0,00/);
    expect(screen.getByText(/Anuladas: 1 venta · 3,00.*No se suman al total/)).toBeInTheDocument();
    expect(app.api.log.some((l) => l.path === "/v1/reports/daily")).toBe(true);
    // lista del día con chips de estado con símbolo
    expect(screen.getAllByRole("listitem").filter((li) => li.classList.contains("srow"))).toHaveLength(3);
    expect(screen.getByText("Anulada")).toBeInTheDocument();
  });

  it("el selector «Otro día» solo ofrece los días con pedidos (GET /orders/days)", async () => {
    const app = await boot();
    await seed(app);
    await renderApp("/ventas");
    const select = (await screen.findByLabelText("Otro día:")) as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBe(2)); // hoy y ayer; ningún otro día
    expect(app.api.log.some((l) => l.path === "/v1/orders/days")).toBe(true);
    const user = userEvent.setup();
    await user.selectOptions(select, select.options[1].value);
    await waitFor(() => expect(screen.getAllByRole("listitem").filter((li) => li.classList.contains("srow"))).toHaveLength(1));
  });

  it("sin pedidos ese día: estado vacío con enlace a la Caja", async () => {
    await boot();
    await renderApp("/ventas");
    expect(await screen.findByText("Sin ventas este día")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ir a la Caja" })).toHaveAttribute("href", "/");
  });

  it("sin conexión solo se ven los pendientes, con aviso y sin resumen", async () => {
    const app = await boot();
    await seed(app);
    app.ctl.down = true;
    const { saveOrder } = await import("@/lib/order-storage");
    await saveOrder({ items: [{ id: "1", name: "Paella Valenciana", price: 4.5, listPrice: 4.5, image: "", quantity: 1 }], paymentMethod: "efectivo" });
    await renderApp("/ventas");
    expect(await screen.findByText(/solo se ven los pedidos sin enviar/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Resumen del día" })).toBeNull();
    expect(screen.getByText("P-1")).toBeInTheDocument();
  });
});

describe("Ventas: detalle, corrección y borrado (servidor)", () => {
  it("Corregir un pedido COMPLETADO: forma de pago y AÑADIR un producto; solo se envía lo que cambió, con If-Match", async () => {
    const app = await boot();
    const ids = await seed(app);
    await renderApp("/ventas");
    const user = userEvent.setup();
    const row = await rowOf(ids.done);
    await user.click(within(row).getByRole("button", { name: "Ver" }));
    await user.click(within(dialog()).getByRole("button", { name: "Corregir" }));
    const ed = within(dialog());
    await user.selectOptions(ed.getByLabelText("Forma de pago"), "bizum");
    await user.click(ed.getByRole("button", { name: "Añadir un plato" }));
    await user.type(within(dialog()).getByLabelText("Buscar plato"), "croq");
    await user.click(within(dialog()).getByRole("button", { name: /Añadir Añadir de Croqueta de jamón|Añadir .* Croqueta de jamón/ }));
    await user.click(within(dialog()).getByRole("button", { name: "Listo" }));
    await user.click(within(dialog()).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(app.api.orders.find((o) => o.id === ids.done)!.revision).toBe(2));
    const o = app.api.orders.find((o) => o.id === ids.done)!;
    expect(o.status).toBe("completado"); // seguía completado: Ventas puede corregir cualquier campo
    expect(o.paymentMethod).toBe("bizum");
    expect(o.items.map((i) => [i.productId, i.quantity])).toEqual([["1", 2], ["3", 1]]);
    const patch = app.api.log.filter((l) => l.method === "PATCH").at(-1)!;
    expect(Object.keys(patch.body).sort()).toEqual(["items", "paymentMethod"]);
    expect(patch.headers["if-match"]).toBe('"1"');
  });

  it("Corregir un pedido ANULADO: cambiar estado y número; un número repetido muestra el error por code", async () => {
    const app = await boot();
    const ids = await seed(app);
    await renderApp("/ventas");
    const user = userEvent.setup();
    const row = await rowOf(ids.void);
    await user.click(within(row).getByRole("button", { name: "Ver" }));
    await user.click(within(dialog()).getByRole("button", { name: "Corregir" }));
    await user.selectOptions(within(dialog()).getByLabelText("Estado"), "completado");
    const num = within(dialog()).getByLabelText("Número del pedido");
    await user.clear(num);
    await user.type(num, "1"); // ya lo usa el primer pedido del día
    await user.click(within(dialog()).getByRole("button", { name: "Guardar" }));
    expect(await within(dialog()).findByText("Ese número ya está en uso ese día.")).toBeInTheDocument();
    await user.clear(num);
    await user.type(num, "9");
    await user.click(within(dialog()).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(app.api.orders.find((o) => o.id === ids.void)!).toMatchObject({ status: "completado", number: 9 }));
  });

  it("Corregir valida la cantidad y el importe antes de enviar", async () => {
    const app = await boot();
    const ids = await seed(app);
    await renderApp("/ventas");
    const user = userEvent.setup();
    const row = await rowOf(ids.done);
    await user.click(within(row).getByRole("button", { name: "Ver" }));
    await user.click(within(dialog()).getByRole("button", { name: "Corregir" }));
    const price = within(dialog()).getByLabelText("Precio (€)");
    await user.clear(price);
    await user.type(price, "4.555");
    await user.click(within(dialog()).getByRole("button", { name: "Guardar" }));
    expect(within(dialog()).getByText(/máximo 2 decimales/)).toBeInTheDocument();
    expect(app.api.log.filter((l) => l.method === "PATCH")).toHaveLength(0);
  });

  it("Borrar pide confirmación y es un borrado lógico: desaparece de la lista y de los totales", async () => {
    const app = await boot();
    const ids = await seed(app);
    await renderApp("/ventas");
    const user = userEvent.setup();
    const row = await rowOf(ids.card);
    await user.click(within(row).getByRole("button", { name: "Ver" }));
    await user.click(within(dialog()).getByRole("button", { name: "Borrar" }));
    await user.click(within(dialog()).getByRole("button", { name: "No, volver" }));
    expect(app.api.orders.find((o) => o.id === ids.card)!.deletedAt).toBeNull();
    await user.click(within(dialog()).getByRole("button", { name: "Borrar" }));
    await user.click(within(dialog()).getByRole("button", { name: "Sí, borrar" }));
    await waitFor(() => expect(app.api.orders.find((o) => o.id === ids.card)!.deletedAt).not.toBeNull());
    await waitFor(() => expect(document.querySelector(`[data-order="${ids.card}"]`)).toBeNull());
    const stats = await screen.findByRole("region", { name: "Resumen del día" });
    expect(within(stats).getByText("Total del día").parentElement).toHaveTextContent(/9,00/);
  });

  it("un pedido pendiente ofrece «Descartar» (no «Borrar») y desaparece sin rastro", async () => {
    const app = await boot();
    app.ctl.down = true;
    const { saveOrder } = await import("@/lib/order-storage");
    await saveOrder({ items: [{ id: "1", name: "Paella Valenciana", price: 4.5, listPrice: 4.5, image: "", quantity: 1 }], paymentMethod: "efectivo" });
    await renderApp("/ventas");
    const user = userEvent.setup();
    await screen.findByText("P-1");
    await user.click(within(document.querySelector(".srow") as HTMLElement).getByRole("button", { name: "Ver" }));
    expect(within(dialog()).queryByRole("button", { name: "Borrar" })).toBeNull();
    await user.click(within(dialog()).getByRole("button", { name: "Descartar" }));
    await user.click(within(dialog()).getByRole("button", { name: "Sí, descartar" }));
    const { listPending } = await import("@/lib/sync/outbox");
    await waitFor(async () => expect(await listPending()).toHaveLength(0));
  });

  it("los nombres de cada línea salen del snapshot del pedido, no del catálogo actual", async () => {
    const app = await boot();
    const ids = await seed(app);
    app.api.products.find((p) => p.id === "1")!.name = "Paella Premium";
    await renderApp("/ventas");
    const user = userEvent.setup();
    const row = await rowOf(ids.done);
    await user.click(within(row).getByRole("button", { name: "Ver" }));
    expect(dialog()).toHaveTextContent("Paella Valenciana");
    expect(dialog()).not.toHaveTextContent("Premium");
  });
});
