import { describe, it, expect } from "vitest";
import { screen, within, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { boot } from "./helpers";
import { renderApp, waitForMenu } from "./render";

describe("accesibilidad básica: roles, foco y etiquetas", () => {
  it("navegación con nombre, pestaña actual con aria-current y encabezado de la pantalla", async () => {
    await boot();
    await renderApp();
    await waitForMenu();
    const nav = screen.getByRole("navigation", { name: "Secciones" });
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(["Caja", "Ventas", "Menú"]);
    expect(within(nav).getByRole("link", { name: "Caja" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { level: 1, name: "Caja" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
  });

  it("los botones de precio de cada ficha dicen qué plato y cuánto; las líneas del ticket nombran el plato", async () => {
    await boot();
    await renderApp();
    await waitForMenu();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Cobrar Completa de Paella Valenciana, 4,50/ }));
    expect(await screen.findByRole("button", { name: /Cobrar Completa de Paella Valenciana, 4,50.*Hay 1 en el ticket/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Añadir uno más: Paella Valenciana" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Quitar uno: Paella Valenciana" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cambiar el precio de Paella Valenciana. Ahora 4,50/ })).toBeInTheDocument();
  });

  it("el diálogo de cobro es un <dialog> con nombre, el foco entra, Esc lo cierra y el foco vuelve al botón que lo abrió", async () => {
    await boot();
    await renderApp();
    await waitForMenu();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Cobrar Completa de Paella Valenciana/ }));
    const open = screen.getAllByRole("button", { name: /^Cobrar/ }).find((b) => b.closest("#ticket"))!;
    open.focus();
    await user.click(open);
    const dlg = screen.getByRole("dialog", { name: "Cobrar" });
    expect(dlg.tagName).toBe("DIALOG");
    expect(dlg.contains(document.activeElement)).toBe(true);
    expect(within(dlg).getByRole("group", { name: "Forma de pago" })).toBeInTheDocument();
    expect(within(dlg).getByRole("button", { name: "Efectivo" })).toHaveAttribute("aria-pressed", "true");
    expect(within(dlg).getByRole("switch", { name: "Dejar en proceso" })).toHaveAttribute("aria-checked", "false");
    // Esc = evento «cancel» del <dialog> nativo
    fireEvent(dlg, new Event("cancel", { cancelable: true }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(open);
  });

  it("los campos de formulario tienen etiqueta (Ventas: Otro día; Corregir; Menú: plato nuevo) y los errores son role=alert", async () => {
    const app = await boot();
    const { api } = await import("@/lib/api");
    await api.orders.create({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      paymentMethod: "efectivo",
      items: [{ productId: "1", name: "Paella Valenciana", unitPrice: 4.5, listPrice: 4.5, quantity: 1, half: false }],
    });
    await renderApp("/ventas");
    const user = userEvent.setup();
    expect(await screen.findByLabelText("Otro día:")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Ver" }));
    await user.click(screen.getByRole("button", { name: "Corregir" }));
    const dlg = screen.getAllByRole("dialog").at(-1)!;
    for (const l of ["Estado", "Forma de pago", "Entrega (€)", "Fecha", "Hora", "Número del pedido", "Plato", "Cantidad", "Precio (€)"])
      expect(within(dlg).getByLabelText(new RegExp(l.replace(/[()€]/g, "\\$&")))).toBeInTheDocument();
    expect(app.api.orders).toHaveLength(1);
  });

  it("formulario de plato: etiquetas, errores al salir del campo con aria-invalid y role=alert", async () => {
    await boot();
    await renderApp("/menu");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "+ Plato nuevo" }));
    const dlg = screen.getByRole("dialog", { name: "Nuevo plato" });
    const name = within(dlg).getByLabelText(/Nombre \(español\)/);
    await user.click(name);
    await user.tab(); // al salir del campo se valida
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(within(dlg).getByText("Falta el nombre.")).toHaveAttribute("role", "alert");
    expect(within(dlg).getByLabelText(/Nombre \(árabe\)/)).toHaveAttribute("dir", "rtl");
    const price = within(dlg).getByLabelText(/Precio ración/);
    await user.type(price, "4.555");
    await user.tab();
    expect(within(dlg).getByText(/máximo 2 decimales/)).toBeInTheDocument();
    expect(within(dlg).getByRole("switch", { name: "Disponible" })).toHaveAttribute("aria-checked", "true");
    expect(within(dlg).getByLabelText("Elegir foto")).toHaveAttribute("type", "file");
  });

  it("el estado de conexión y los pendientes se anuncian en una región role=status", async () => {
    const app = await boot();
    await renderApp();
    await waitForMenu();
    const live = document.querySelector('header [role="status"]') as HTMLElement;
    expect(live).toHaveAttribute("aria-live", "polite");
    app.ctl.down = true;
    const { saveOrder } = await import("@/lib/order-storage");
    await saveOrder({ items: [{ id: "1", name: "Paella Valenciana", price: 4.5, listPrice: 4.5, image: "", quantity: 1 }], paymentMethod: "efectivo" });
    await waitFor(() => expect(live).toHaveTextContent("1 sin enviar"));
    expect(screen.getByRole("button", { name: /1 sin enviar/ })).toBeInTheDocument();
  });

  it("pantalla de entrada: encabezado, botones con nombre y selector de idioma con su `lang`", async () => {
    const { installServer } = await import("./helpers");
    installServer();
    await renderApp();
    expect(await screen.findByRole("heading", { level: 1, name: "Entrar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Entrar con Microsoft" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "العربية — تغيير اللغة" })).toHaveAttribute("lang", "ar-EG");
  });
});
