import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  createKnowledgeItem,
  deleteKnowledgeItem,
  fetchKnowledgeItems,
  updateKnowledgeItem,
  type KnowledgeItem,
} from "../../api/knowledge";
import { EmptyState } from "../ui/EmptyState";
import { ErrorBanner } from "../ui/ErrorBanner";
import { LoadingState } from "../ui/LoadingState";

interface ProductCatalogPanelProps {
  readOnly?: boolean;
}

function formatPrice(item: KnowledgeItem): string {
  if (item.price === null || item.price === undefined) return "—";
  return `${item.currency ?? "USD"} ${item.price.toFixed(2)}`;
}

export function ProductCatalogPanel({ readOnly = false }: ProductCatalogPanelProps) {
  const [products, setProducts] = useState<KnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<KnowledgeItem | null>(null);
  const [creating, setCreating] = useState(false);

  const loadProducts = useCallback(async () => {
    setError("");
    try {
      const items = await fetchKnowledgeItems({ section: "products" });
      setProducts(items.filter((item) => item.type === "product"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load products");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  async function handleDelete(item: KnowledgeItem) {
    if (!window.confirm(`Delete "${item.title}"?`)) return;
    setBusy(true);
    try {
      await deleteKnowledgeItem(item.id);
      await loadProducts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete product");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="product-catalog" aria-label="Product catalog">
      <div className="kb-header-actions">
        <p className="integrations-copy">
          Manage products the Sales Agent can recommend. Only catalog data is shown to customers —
          never invented prices.
        </p>
        {!readOnly ? (
          <button
            type="button"
            className="agent-btn agent-btn--primary"
            onClick={() => setCreating(true)}
          >
            Add product
          </button>
        ) : null}
      </div>

      {error ? <ErrorBanner message={error} onRetry={() => void loadProducts()} /> : null}

      {loading ? (
        <LoadingState label="Loading products…" />
      ) : products.length === 0 ? (
        <EmptyState
          title="No products yet"
          description="Add products with title, description, price, and image URL for the Sales Agent."
        />
      ) : (
        <ul className="product-catalog-list">
          {products.map((product) => (
            <li key={product.id} className="product-catalog-item">
              {product.imageUrl ? (
                <img src={product.imageUrl} alt={product.title} className="product-catalog-item__image" />
              ) : (
                <div className="product-catalog-item__image product-catalog-item__image--placeholder">
                  No image
                </div>
              )}
              <div className="product-catalog-item__body">
                <strong>{product.title}</strong>
                <p>{formatPrice(product)}</p>
                <p className="integrations-copy">{product.content.slice(0, 120)}</p>
                {product.stockStatus ? (
                  <span className="badge">{product.stockStatus.replaceAll("_", " ")}</span>
                ) : null}
              </div>
              {!readOnly ? (
                <div className="product-catalog-item__actions">
                  <button
                    type="button"
                    className="agent-btn agent-btn--ghost"
                    onClick={() => setEditing(product)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="agent-btn agent-btn--ghost"
                    disabled={busy}
                    onClick={() => void handleDelete(product)}
                  >
                    Delete
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {(creating || editing) && !readOnly ? (
        <ProductFormModal
          item={editing}
          busy={busy}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSave={async (input) => {
            setBusy(true);
            try {
              const payload = {
                title: input.title,
                content: input.content,
                tags: input.tags,
                imageUrl: input.imageUrl || null,
                price: input.price ? Number(input.price) : null,
                currency: input.currency || "USD",
                stockStatus: input.stockStatus || null,
              };
              if (editing) {
                await updateKnowledgeItem(editing.id, payload);
              } else {
                await createKnowledgeItem({
                  section: "products",
                  type: "product",
                  ...payload,
                });
              }
              await loadProducts();
              setCreating(false);
              setEditing(null);
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : null}
    </section>
  );
}

function ProductFormModal({
  item,
  busy,
  onClose,
  onSave,
}: {
  item: KnowledgeItem | null;
  busy?: boolean;
  onClose: () => void;
  onSave: (input: {
    title: string;
    content: string;
    tags: string;
    imageUrl: string;
    price: string;
    currency: string;
    stockStatus: string;
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState(item?.title ?? "");
  const [content, setContent] = useState(item?.content ?? "");
  const [tags, setTags] = useState(item?.tags?.join(", ") ?? "");
  const [imageUrl, setImageUrl] = useState(item?.imageUrl ?? "");
  const [price, setPrice] = useState(item?.price?.toString() ?? "");
  const [currency, setCurrency] = useState(item?.currency ?? "USD");
  const [stockStatus, setStockStatus] = useState(item?.stockStatus ?? "in_stock");
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await onSave({ title, content, tags, imageUrl, price, currency, stockStatus });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save product");
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div className="modal-panel modal-panel--wide" role="dialog" onClick={(event) => event.stopPropagation()}>
        <header className="modal-panel__header">
          <h2>{item ? "Edit product" : "Add product"}</h2>
          <button type="button" className="modal-panel__close" onClick={onClose}>
            Close
          </button>
        </header>
        <form className="modal-panel__body" onSubmit={(event) => void handleSubmit(event)}>
          {error ? <ErrorBanner message={error} /> : null}
          <label className="kb-field">
            Title
            <input value={title} onChange={(event) => setTitle(event.target.value)} required />
          </label>
          <label className="kb-field">
            Description
            <textarea rows={4} value={content} onChange={(event) => setContent(event.target.value)} required />
          </label>
          <label className="kb-field">
            Image URL
            <input value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="https://…" />
          </label>
          <div className="channel-form">
            <label className="kb-field">
              Price
              <input
                type="number"
                min="0"
                step="0.01"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
              />
            </label>
            <label className="kb-field">
              Currency
              <input value={currency} onChange={(event) => setCurrency(event.target.value)} />
            </label>
          </div>
          <label className="kb-field">
            Stock status
            <select value={stockStatus} onChange={(event) => setStockStatus(event.target.value)}>
              <option value="in_stock">In stock</option>
              <option value="low_stock">Low stock</option>
              <option value="out_of_stock">Out of stock</option>
              <option value="preorder">Preorder</option>
            </select>
          </label>
          <label className="kb-field">
            Tags (comma-separated)
            <input value={tags} onChange={(event) => setTags(event.target.value)} />
          </label>
          <button type="submit" className="agent-btn agent-btn--primary" disabled={busy}>
            {busy ? "Saving…" : "Save product"}
          </button>
        </form>
      </div>
    </div>
  );
}
