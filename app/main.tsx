import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import "../styles/globals.css"; // or './globals.css' if that's where yours lives

import App from "./App";
import Home from "./Home";
import PedidosPage from "./pedidos/page";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/pedidos" element={<PedidosPage />} />
        </Routes>
      </App>
    </BrowserRouter>
  </React.StrictMode>,
);
