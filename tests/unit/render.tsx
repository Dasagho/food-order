import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/** Renderiza la aplicación completa (rutas, proveedores y pantallas) tras vi.resetModules(). */
export async function renderApp(path = "/") {
  const { App } = await import("@/app");
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

/** Espera a que la Caja muestre el catálogo. */
export const waitForMenu = () => screen.findByText("Paella Valenciana");
