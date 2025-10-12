import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X } from "lucide-react";
import type { MenuItem, MenuCategory } from "@/types/order";
import { getCategories } from "@/lib/product-storage";

interface ProductFormProps {
  product?: MenuItem;
  onSave: (product: MenuItem) => void;
  onCancel: () => void;
}

export function ProductForm({ product, onSave, onCancel }: ProductFormProps) {
  const [formData, setFormData] = useState<MenuItem>(
    product || {
      id: crypto.randomUUID(),
      name: "",
      price: 0,
      image: "",
      category: "principales",
      portionType: "unidades",
      halfPortionPrice: undefined,
    },
  );
  const [categories, setCategories] = useState<
    { id: MenuCategory; name: string }[]
  >([]);

  useEffect(() => {
    setCategories(getCategories());
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-6">
      <div className="bg-background rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-background border-b border-border p-6 flex justify-between items-center">
          <h2 className="text-3xl font-bold">
            {product ? "Editar Producto" : "Nuevo Producto"}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onCancel}
            className="h-12 w-12"
          >
            <X className="w-8 h-8" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div className="space-y-3">
            <Label htmlFor="name" className="text-xl">
              Nombre del Producto
            </Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
              required
              className="h-14 text-lg"
            />
          </div>

          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-3">
              <Label htmlFor="price" className="text-xl">
                Precio (€)
              </Label>
              <Input
                id="price"
                type="number"
                step="0.01"
                value={formData.price}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    price: Number.parseFloat(e.target.value),
                  })
                }
                required
                className="h-14 text-lg"
              />
            </div>

            <div className="space-y-3">
              <Label htmlFor="category" className="text-xl">
                Categoría
              </Label>
              <Select
                value={formData.category}
                onValueChange={(value) =>
                  setFormData({ ...formData, category: value as MenuCategory })
                }
              >
                <SelectTrigger className="h-14 text-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id} className="text-lg">
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-3">
            <Label htmlFor="portionType" className="text-xl">
              Tipo de Porción
            </Label>
            <Select
              value={formData.portionType}
              onValueChange={(value) =>
                setFormData({
                  ...formData,
                  portionType: value as "racion" | "unidades",
                  halfPortionPrice:
                    value === "unidades"
                      ? undefined
                      : formData.halfPortionPrice,
                })
              }
            >
              <SelectTrigger className="h-14 text-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unidades" className="text-lg">
                  Por Unidades
                </SelectItem>
                <SelectItem value="racion" className="text-lg">
                  Por Ración
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {formData.portionType === "racion" && (
            <div className="space-y-3">
              <Label htmlFor="halfPortionPrice" className="text-xl">
                Precio Media Ración (€)
              </Label>
              <Input
                id="halfPortionPrice"
                type="number"
                step="0.01"
                value={formData.halfPortionPrice || ""}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    halfPortionPrice: Number.parseFloat(e.target.value),
                  })
                }
                className="h-14 text-lg"
              />
            </div>
          )}

          <div className="space-y-3">
            <Label htmlFor="image" className="text-xl">
              URL de la Imagen
            </Label>
            <Input
              id="image"
              type="url"
              value={formData.image}
              onChange={(e) =>
                setFormData({ ...formData, image: e.target.value })
              }
              placeholder="https://ejemplo.com/imagen.jpg"
              required
              className="h-14 text-lg"
            />
            {formData.image && (
              <div className="mt-4">
                <img
                  src={formData.image || "/placeholder.svg"}
                  alt="Preview"
                  className="w-full h-48 object-cover rounded-lg"
                />
              </div>
            )}
          </div>

          <div className="flex gap-4 pt-6">
            <Button type="submit" size="lg" className="flex-1 h-16 text-xl">
              {product ? "Actualizar" : "Crear"} Producto
            </Button>
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={onCancel}
              className="flex-1 h-16 text-xl bg-transparent"
            >
              Cancelar
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
