import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import { Toaster } from "sonner";
import "./styles/globals.css";
import "./globals.css";

import Home from "./Home";
import PedidosPage from "./pedidos/page";
import AdminPage from "./admin/page";

registerSW({
  onNeedRefresh() {},
  onOfflineReady() {},
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/pedidos" element={<PedidosPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Routes>
    </BrowserRouter>
    <Toaster position="top-center" richColors />
  </React.StrictMode>,
);
