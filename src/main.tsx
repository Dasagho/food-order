import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import "./styles/globals.css";

import App from "./App";
import Home from "./Home";
import PedidosPage from "./pedidos/page";

registerSW({
  onNeedRefresh() {},
  onOfflineReady() {},
});

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
