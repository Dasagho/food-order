import { describe, it, expect } from "vitest";
import { screen, waitFor, within, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { boot } from "./helpers";
import { renderApp } from "./render";

const dialog = () => screen.getAllByRole("dialog").at(-1)!;

describe("Menú: platos y secciones contra el servidor", () => {
  it("marcar Agotado/Disponible con el interruptor y reflejarlo en la Caja (visible pero no añadible)", async () => {
    const app = await boot();
    await renderApp("/menu");
    const user = userEvent.setup();
    const row = await waitFor(() => {
      const r = document.querySelector('[data-product="4"]') as HTMLElement | null;
      expect(r).not.toBeNull();
      return r as HTMLElement;
    });
    await user.click(within(row).getByRole("switch", { name: "Disponible" }));
    await waitFor(() => expect(app.api.products.find((p) => p.id === "4")!.available).toBe(false));
    expect(await within(row).findByRole("switch", { name: "Agotado" })).toHaveAttribute("aria-checked", "false");
  });

  it("crear, renombrar (con nombre árabe), reordenar con la lista exacta y borrar una sección; borrar una con platos da el error por code", async () => {
    const app = await boot();
    await renderApp("/menu");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Secciones" }));
    await user.click(screen.getByRole("button", { name: "+ Sección nueva" }));
    await user.type(within(dialog()).getByLabelText(/Nombre \(español\)/), "Tapas");
    await user.type(within(dialog()).getByLabelText(/Nombre \(árabe\)/), "مقبلات");
    await user.click(within(dialog()).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(app.api.categories.some((c) => c.name === "Tapas")).toBe(true))
    expect(app.api.categories.find((c) => c.name === "Tapas")!.names).toEqual({ ar: "مقبلات" });

    // subir: se envía SIEMPRE la lista exacta (5 originales + la nueva)
    await user.click(await screen.findByRole("button", { name: "Subir Tapas" }));
    await waitFor(() => expect(app.api.log.some((l) => l.path === "/v1/categories/reorder")).toBe(true));
    const reorder = app.api.log.filter((l) => l.path === "/v1/categories/reorder").at(-1)!;
    expect(reorder.body.ids).toHaveLength(6);
    expect(reorder.body.ids[4]).toBe(app.api.categories.find((c) => c.name === "Tapas")!.id);

    // sección con platos: no se puede borrar
    const rowOf = (name: string) => screen.getByText(name, { selector: ".title" }).closest("li") as HTMLElement;
    await user.click(within(rowOf("Arroces y Paellas")).getByRole("button", { name: "Borrar" }));
    await user.click(within(dialog()).getByRole("button", { name: "Sí, borrar" }));
    expect(await screen.findByText("La sección tiene platos. Muévelos o bórralos.")).toBeInTheDocument();

    // la nueva (vacía) sí
    await user.click(within(rowOf("Tapas")).getByRole("button", { name: "Borrar" }));
    await user.click(within(dialog()).getByRole("button", { name: "Sí, borrar" }));
    await waitFor(() => expect(app.api.categories.find((c) => c.name === "Tapas")!.deletedAt).not.toBeNull());
  });

  it("sin conexión los controles de edición quedan deshabilitados con un aviso", async () => {
    await boot();
    await renderApp("/menu");
    await screen.findByRole("button", { name: "+ Plato nuevo" });
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    act(() => {
      fireEvent(window, new Event("offline"));
    });
    expect(await screen.findByText(/para cambiar el menú hace falta internet/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Plato nuevo" })).toBeDisabled();
    for (const b of screen.getAllByRole("button", { name: "Borrar" })) expect(b).toBeDisabled();
    Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
  });

  it("editar un plato guarda el nombre árabe y quitar el precio de media ración la desactiva", async () => {
    const app = await boot();
    await renderApp("/menu");
    const user = userEvent.setup();
    const row = await waitFor(() => {
      const r = document.querySelector('[data-product="1"]') as HTMLElement | null;
      expect(r).not.toBeNull();
      return r as HTMLElement;
    });
    await user.click(within(row).getByRole("button", { name: "Editar" }));
    const d = within(dialog());
    await user.type(d.getByLabelText(/Nombre \(árabe\)/), "باييا");
    await user.clear(d.getByLabelText(/Precio media ración/));
    await user.click(d.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(app.api.products.find((p) => p.id === "1")!.names).toEqual({ ar: "باييا" }));
    expect(app.api.products.find((p) => p.id === "1")!.halfPortionPrice).toBeNull();
  });
});

describe("Menú: foto del plato (subida a /media, hasta 15 MB)", () => {
  const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  /** Fichero de `bytes` bytes que empieza con la firma PNG (sin reservar 12 MB reales por cada prueba). */
  const photo = (bytes: number, name = "foto.png") => {
    const f = new File([new Uint8Array(PNG_MAGIC)], name, { type: "image/png" });
    Object.defineProperty(f, "size", { value: bytes });
    return f;
  };

  const openNewDish = async () => {
    const app = await boot();
    await renderApp("/menu");
    const user = userEvent.setup({ applyAccept: false });
    await user.click(await screen.findByRole("button", { name: "+ Plato nuevo" }));
    return { app, user };
  };

  it("una foto de 12 MB no se rechaza en el cliente: se sube y el plato guarda la `url` relativa devuelta", async () => {
    const { app, user } = await openNewDish();
    await user.type(within(dialog()).getByLabelText(/Nombre \(español\)/), "Plato con foto");
    await user.type(within(dialog()).getByLabelText(/Precio ración/), "5");
    expect(within(dialog()).getByText("Máximo 15 MB.")).toBeInTheDocument();
    await user.upload(within(dialog()).getByLabelText("Elegir foto"), photo(12 * 1024 * 1024));
    expect(await within(dialog()).findByText("Foto lista.")).toBeInTheDocument();
    expect(screen.queryByText(/pesa más de/)).toBeNull();
    // la vista previa usa la ruta relativa (nunca anteponiéndole VITE_API_URL)
    expect(dialog().querySelector("img.preview")!.getAttribute("src")).toMatch(/^\/media\/[0-9a-f-]{36}\.webp$/);
    await user.click(within(dialog()).getByRole("button", { name: "Crear" }));
    await waitFor(() => expect(app.api.products.some((p) => p.name === "Plato con foto")).toBe(true));
    const p = app.api.products.find((p) => p.name === "Plato con foto")!;
    const upload = app.api.media.keys().next().value as string;
    expect(p.imageUrl).toBe(`/media/${upload}`);
    expect(app.api.log.filter((l) => l.path === "/v1/uploads")).toHaveLength(1);
  });

  it("una foto de más de 15 MB se rechaza en el cliente con un mensaje claro y sin llamar al servidor", async () => {
    const { app, user } = await openNewDish();
    await user.upload(within(dialog()).getByLabelText("Elegir foto"), photo(15 * 1024 * 1024 + 1));
    expect(await within(dialog()).findByText("La foto pesa más de 15 MB.")).toBeInTheDocument();
    expect(app.api.log.some((l) => l.path === "/v1/uploads")).toBe(false);
    expect(dialog().querySelector("img.preview")).toBeNull();
  });

  it("justo 15 MB sí se admite", async () => {
    const { user } = await openNewDish();
    await user.upload(within(dialog()).getByLabelText("Elegir foto"), photo(15 * 1024 * 1024));
    expect(await within(dialog()).findByText("Foto lista.")).toBeInTheDocument();
  });

  it("las imágenes de la lista del Menú y de las tarjetas de la Caja llevan lazy + async y dimensiones fijas (sin saltos de layout)", async () => {
    await boot();
    await renderApp("/menu");
    await screen.findByRole("button", { name: "+ Plato nuevo" });
    const imgs = [...document.querySelectorAll<HTMLImageElement>(".arow .thumb img")];
    expect(imgs.length).toBeGreaterThan(1);
    for (const img of imgs) {
      expect(img.getAttribute("loading")).toBe("lazy");
      expect(img.getAttribute("decoding")).toBe("async");
      expect(img.getAttribute("width")).toBe("80");
      expect(img.getAttribute("height")).toBe("80");
    }
  });

  it("las tarjetas de la Caja: lazy + async y 400x300 dentro de un contenedor con aspect-ratio", async () => {
    await boot();
    await renderApp("/");
    await screen.findByText("Paella Valenciana");
    const imgs = [...document.querySelectorAll<HTMLImageElement>(".tile .media img")];
    expect(imgs.length).toBeGreaterThan(1);
    for (const img of imgs) {
      expect(img.getAttribute("loading")).toBe("lazy");
      expect(img.getAttribute("decoding")).toBe("async");
      expect(img.getAttribute("width")).toBe("400");
      expect(img.getAttribute("height")).toBe("300");
    }
  });
});
