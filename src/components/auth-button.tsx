import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { LogIn, LogOut, User, Wifi, WifiOff } from "lucide-react";
import {
  loginWithOAuth,
  logout,
  isAuthenticated,
  getCurrentUser,
  isOnline,
  onAuthChange,
  syncAllOrdersToPocketBase,
} from "@/lib/pocketbase";
import { toast } from "sonner";
import { getOrders } from "@/lib/order-storage";

export function AuthButton() {
  const [authenticated, setAuthenticated] = useState(false);
  const [online, setOnline] = useState(true);
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Verificar estado inicial
    setAuthenticated(isAuthenticated());
    setUser(getCurrentUser());
    setOnline(isOnline());

    // Listener para cambios de autenticaci�n
    onAuthChange((isAuth) => {
      setAuthenticated(isAuth);
      setUser(getCurrentUser());
    });

    // Listener para cambios de conexión
    const handleOnline = () => {
      setOnline(true);
      toast.success("Conexión a internet restaurada");
      syncAllOrdersToPocketBase(getOrders());
    };

    const handleOffline = () => {
      setOnline(false);
      toast.warning("Sin conexión a internet - Modo offline");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const handleLogin = async () => {
    if (!online) {
      toast.error("No hay conexión a internet");
      return;
    }

    setLoading(true);
    try {
      await loginWithOAuth("microsoft");
      toast.success("Sesión iniciada correctamente");
    } catch (error) {
      toast.error("Error al iniciar sesión");
      console.error(error);
    } finally {
      syncAllOrdersToPocketBase(getOrders());
      setLoading(false);
    }
  };

  const handleLogout = () => {
    logout();
    setAuthenticated(false);
    setUser(null);
    toast.success("Sesión cerrada");
  };

  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted text-sm">
        {online ? (
          <div className="px-2 py-1 gap-2 flex justify-center items-center text-lg">
            <Wifi className="w-4 h-4 text-green-500" />
            <span className="font-medium">Online</span>
          </div>
        ) : (
          <>
            <WifiOff className="w-4 h-4 text-red-500" />
            <span className="font-medium">Offline</span>
          </>
        )}
      </div>

      {authenticated ? (
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary/10 text-lg">
            <User className="w-4 h-4" />
            <span className="font-medium">{user?.email || "Usuario"}</span>
          </div>
          <Button
            onClick={handleLogout}
            variant="outline"
            size="lg"
            className="h-9 px-4 py-6 text-lg bg-transparent"
          >
            <LogOut className="w-4 h-4 mr-1.5" />
            Cerrar Sesión
          </Button>
        </div>
      ) : (
        <Button
          onClick={handleLogin}
          disabled={loading || !online}
          size="sm"
          className="h-9 px-4"
        >
          <LogIn className="w-4 h-4 mr-1.5" />
          {loading ? "Iniciando..." : "Iniciar Sesión"}
        </Button>
      )}
    </div>
  );
}
