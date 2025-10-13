"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  GripVertical,
  ArrowUpDown,
} from "lucide-react";
import type { MenuItem, Category } from "@/types/order";
import {
  getProducts,
  saveProduct,
  deleteProduct,
  getCategories,
  updateProductOrder,
} from "@/lib/product-storage";
import { ProductForm } from "@/components/product-form";
import { useNavigate } from "react-router-dom";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

function SortableProductCard({
  product,
  getCategoryName,
}: {
  product: MenuItem;
  getCategoryName: (id: string) => string;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: product.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="bg-card rounded-xl shadow-lg overflow-hidden border-2 border-primary"
    >
      <div className="relative h-48">
        <div
          {...attributes}
          {...listeners}
          className="absolute top-2 left-2 z-10 cursor-grab active:cursor-grabbing bg-primary text-primary-foreground rounded-lg p-3 hover:bg-primary/90 transition-colors shadow-lg"
        >
          <GripVertical className="w-8 h-8" />
        </div>
        <img
          src={product.image || "/placeholder.svg"}
          alt={product.name}
          className="w-full h-full object-cover"
        />
      </div>
      <div className="p-6">
        <div className="mb-3">
          <span className="text-sm font-medium text-muted-foreground">
            {getCategoryName(product.category)}
          </span>
        </div>
        <h3 className="text-2xl font-bold mb-2">{product.name}</h3>
        <div className="mb-4">
          <p className="text-3xl font-bold text-primary">
            {product.price.toFixed(2)}€
          </p>
          {product.portionType === "racion" && product.halfPortionPrice && (
            <p className="text-lg text-muted-foreground">
              Media: {product.halfPortionPrice.toFixed(2)}€
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const [products, setProducts] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [editingProduct, setEditingProduct] = useState<MenuItem | null>(null);
  const [showProductForm, setShowProductForm] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"manage" | "reorder">("manage");
  const navigate = useNavigate();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  useEffect(() => {
    loadData();
  }, []);

  const loadData = () => {
    const loadedProducts = getProducts();
    const sortedProducts = loadedProducts.sort((a, b) => {
      const orderA = a.displayOrder ?? 999;
      const orderB = b.displayOrder ?? 999;
      return orderA - orderB;
    });
    setProducts(sortedProducts);
    setCategories(getCategories());
  };

  const handleSaveProduct = (product: MenuItem) => {
    saveProduct(product);
    loadData();
    setShowProductForm(false);
    setEditingProduct(null);
  };

  const handleDeleteProduct = (productId: string) => {
    if (confirm("¿Estás seguro de que quieres eliminar este producto?")) {
      deleteProduct(productId);
      loadData();
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setProducts((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over.id);

        const newItems = arrayMove(items, oldIndex, newIndex);

        const updatedItems = newItems.map((item, index) => ({
          ...item,
          displayOrder: index,
        }));

        updateProductOrder(updatedItems);

        return updatedItems;
      });
    }
  };

  const filteredProducts =
    selectedCategory === "all"
      ? products
      : products.filter((p) => p.category === selectedCategory);

  const getCategoryName = (categoryId: string) => {
    return categories.find((c) => c.id === categoryId)?.name || categoryId;
  };

  return (
    <main className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="lg"
              onClick={() => navigate("/")}
              className="h-16 px-6"
            >
              <ArrowLeft className="w-8 h-8 mr-2" />
              <span className="text-xl">Volver</span>
            </Button>
            <h1 className="text-5xl font-bold">Panel de Administración</h1>
          </div>
          <div className="flex gap-4">
            <Button
              variant={viewMode === "reorder" ? "default" : "outline"}
              size="lg"
              onClick={() =>
                setViewMode(viewMode === "manage" ? "reorder" : "manage")
              }
              className="h-16 px-8 text-xl"
            >
              <ArrowUpDown className="w-8 h-8 mr-2" />
              {viewMode === "manage" ? "Reordenar" : "Gestionar"}
            </Button>
            {viewMode === "manage" && (
              <Button
                size="lg"
                onClick={() => {
                  setEditingProduct(null);
                  setShowProductForm(true);
                }}
                className="h-16 px-8 text-xl"
              >
                <Plus className="w-8 h-8 mr-2" />
                Nuevo Producto
              </Button>
            )}
          </div>
        </div>

        {viewMode === "reorder" && (
          <div className="mb-6 p-6 bg-primary/10 border-2 border-primary rounded-lg">
            <p className="text-2xl font-semibold text-primary">
              Arrastra las tarjetas para cambiar el orden en que aparecen en el
              menú
            </p>
          </div>
        )}

        {/* Filtro por categoría */}
        <div className="mb-8 flex gap-3 flex-wrap">
          <Button
            variant={selectedCategory === "all" ? "default" : "outline"}
            size="lg"
            onClick={() => setSelectedCategory("all")}
            className="h-14 px-6 text-lg"
          >
            Todos
          </Button>
          {categories.map((cat) => (
            <Button
              key={cat.id}
              variant={selectedCategory === cat.id ? "default" : "outline"}
              size="lg"
              onClick={() => setSelectedCategory(cat.id)}
              className="h-14 px-6 text-lg"
            >
              {cat.name}
            </Button>
          ))}
        </div>

        {viewMode === "reorder" ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={filteredProducts.map((p) => p.id)}
              strategy={rectSortingStrategy}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {filteredProducts.map((product) => (
                  <SortableProductCard
                    key={product.id}
                    product={product}
                    getCategoryName={getCategoryName}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredProducts.map((product) => (
              <div
                key={product.id}
                className="bg-card rounded-xl shadow-lg overflow-hidden border border-border"
              >
                <div className="relative h-48">
                  <img
                    src={product.image || "/placeholder.svg"}
                    alt={product.name}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="p-6">
                  <div className="mb-3">
                    <span className="text-sm font-medium text-muted-foreground">
                      {getCategoryName(product.category)}
                    </span>
                  </div>
                  <h3 className="text-2xl font-bold mb-2">{product.name}</h3>
                  <div className="mb-4">
                    <p className="text-3xl font-bold text-primary">
                      {product.price.toFixed(2)}€
                    </p>
                    {product.portionType === "racion" &&
                      product.halfPortionPrice && (
                        <p className="text-lg text-muted-foreground">
                          Media: {product.halfPortionPrice.toFixed(2)}€
                        </p>
                      )}
                    <p className="text-sm text-muted-foreground mt-1">
                      {product.portionType === "racion"
                        ? "Por Ración"
                        : "Por Unidades"}
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <Button
                      variant="outline"
                      size="lg"
                      onClick={() => {
                        setEditingProduct(product);
                        setShowProductForm(true);
                      }}
                      className="flex-1 h-14 text-lg"
                    >
                      <Pencil className="w-6 h-6 mr-2" />
                      Editar
                    </Button>
                    <Button
                      variant="destructive"
                      size="lg"
                      onClick={() => handleDeleteProduct(product.id)}
                      className="h-14 px-6"
                    >
                      <Trash2 className="w-6 h-6" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {filteredProducts.length === 0 && (
          <div className="text-center py-16">
            <p className="text-2xl text-muted-foreground">
              No hay productos en esta categoría
            </p>
          </div>
        )}
      </div>

      {showProductForm && (
        <ProductForm
          product={editingProduct || undefined}
          onSave={handleSaveProduct}
          onCancel={() => {
            setShowProductForm(false);
            setEditingProduct(null);
          }}
        />
      )}
    </main>
  );
}
