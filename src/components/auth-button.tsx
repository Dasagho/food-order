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
} from "@/lib/pocketbase";
import { toast } from "sonner";

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
    <div className="flex items-center gap-3">
      {/* Indicador de conexión */}
      <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-muted">
        {online ? (
          <>
            <Wifi className="w-5 h-5 text-green-500" />
            <span className="text-sm font-medium">Online</span>
          </>
        ) : (
          <>
            <WifiOff className="w-5 h-5 text-red-500" />
            <span className="text-sm font-medium">Offline</span>
          </>
        )}
      </div>

      {/* Bot�n de autenticaci�n */}
      {authenticated ? (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/10">
            <User className="w-5 h-5" />
            <span className="text-sm font-medium">
              {user?.email || "Usuario"}
            </span>
          </div>
          <Button
            onClick={handleLogout}
            variant="outline"
            size="lg"
            className="h-12 px-6 text-lg bg-transparent"
          >
            <LogOut className="w-5 h-5 mr-2" />
            Cerrar Sesión
          </Button>
        </div>
      ) : (
        <Button
          onClick={handleLogin}
          disabled={loading || !online}
          size="lg"
          className="h-12 px-6 text-lg"
        >
          <LogIn className="w-5 h-5 mr-2" />
          {loading ? "Iniciando..." : "Iniciar Sesión"}
        </Button>
      )}
    </div>
  );
}
