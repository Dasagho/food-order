import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { registerSW } from "virtual:pwa-register";
import { Toaster } from "sonner";
import "./styles/globals.css";
import "./globals.css";

import Home from "./Home";

// Rutas secundarias: se descargan al entrar (el service worker las precachea
// al instalar, así que también funcionan sin conexión)
const PedidosPage = lazy(() => import("./pedidos/page"));
const AdminPage = lazy(() => import("./admin/page"));

registerSW({
  onNeedRefresh() {},
  onOfflineReady() {},
});

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Suspense fallback={<div className="min-h-screen bg-background" />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/pedidos" element={<PedidosPage />} />
          <Route path="/admin" element={<AdminPage />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
    <Toaster position="top-center" richColors />
  </React.StrictMode>,
);
