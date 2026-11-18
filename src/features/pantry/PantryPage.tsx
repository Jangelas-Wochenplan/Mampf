import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ImagePlus, Package, Pencil, Plus, ScanLine, Trash2, X } from "lucide-react";
import { formatQuantity } from "../../lib/format";
import { commonIngredientUnits, ingredientUnitGroups } from "../../lib/ingredient-units";
import type { PantryItem } from "../../types";
import BarcodeScanner from "./BarcodeScanner";

export interface PantryItemSaveInput {
  id: string | null;
  name: string;
  barcode: string;
  quantity: number;
  unit: string;
  imageFile: File | null;
  removeImage: boolean;
}

interface PantryPageProps {
  items: PantryItem[];
  busy: boolean;
  onSave: (item: PantryItemSaveInput) => Promise<void>;
  onDelete: (item: PantryItem) => Promise<void>;
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Der Vorrat konnte nicht gespeichert werden. Bitte versuche es noch einmal.";
}

export default function PantryPage({ items, busy, onSave, onDelete }: PantryPageProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<PantryItem | null>(null);
  const [name, setName] = useState("");
  const [barcode, setBarcode] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [formError, setFormError] = useState("");
  const [pageError, setPageError] = useState("");
  const [search, setSearch] = useState("");
  const photoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!imageFile) {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  const visibleItems = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("de-DE");
    const sortedItems = items.slice().sort((a, b) => a.name.localeCompare(b.name, "de-DE"));
    if (!needle) return sortedItems;
    return sortedItems.filter((item) =>
      `${item.name} ${item.barcode}`.toLocaleLowerCase("de-DE").includes(needle),
    );
  }, [items, search]);
  const hasPreviewImage = Boolean(previewUrl || (!removeImage && editingItem?.image_url));

  function resetForm(item: PantryItem | null) {
    setEditingItem(item);
    setName(item?.name ?? "");
    setBarcode(item?.barcode ?? "");
    setQuantity(item ? String(item.quantity) : "");
    setUnit(item?.unit ?? "");
    setImageFile(null);
    setRemoveImage(false);
    setFormError("");
    setPageError("");
    setFormOpen(true);
  }

  function useScannedBarcode(scannedBarcode: string) {
    const existing = items.find((item) => item.barcode === scannedBarcode);
    resetForm(existing ?? null);
    if (existing) {
      setPageError(`„${existing.name}“ ist bereits im Vorrat. Passe die vorhandene Menge an.`);
    }
    setBarcode(scannedBarcode);
    setScannerOpen(false);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    const parsedQuantity = Number(quantity.replace(",", "."));
    if (!name.trim()) {
      setFormError("Bitte gib einen Produktnamen ein.");
      return;
    }
    if (!Number.isFinite(parsedQuantity) || parsedQuantity < 0) {
      setFormError("Bitte gib eine gültige Vorratsmenge ein.");
      return;
    }
    if (imageFile && (!imageFile.type.startsWith("image/") || imageFile.size > 8 * 1024 * 1024)) {
      setFormError("Bitte wähle ein Bild mit höchstens 8 MB aus.");
      return;
    }
    try {
      await onSave({
        id: editingItem?.id ?? null,
        name: name.trim(),
        barcode: barcode.trim(),
        quantity: parsedQuantity,
        unit,
        imageFile,
        removeImage,
      });
      setFormOpen(false);
      setPageError("");
    } catch (reason) {
      setFormError(errorText(reason));
    }
  }

  async function deleteItem(item: PantryItem) {
    if (!window.confirm(`„${item.name}“ aus dem Vorrat entfernen?`)) return;
    setPageError("");
    try {
      await onDelete(item);
    } catch (reason) {
      setPageError(errorText(reason));
    }
  }

  return (
    <div className="section-page pantry-page">
      <div className="page-title-row">
        <div>
          <p className="eyebrow">Gut versorgt</p>
          <h1>Eure Vorräte</h1>
          <p>Behaltet den Überblick und seht beim Einkauf, was schon da ist. Bestände könnt ihr jederzeit selbst anpassen.</p>
        </div>
        <div className="page-actions pantry-page-actions">
          <button className="button button-outline" onClick={() => setScannerOpen(true)}>
            <ScanLine size={17} /> Barcode scannen
          </button>
          <button className="button button-primary" onClick={() => resetForm(null)}>
            <Plus size={17} /> Vorrat hinzufügen
          </button>
        </div>
      </div>

      {pageError && !formOpen && <p className="form-error pantry-page-error" role="alert">{pageError}</p>}
      <div className="pantry-toolbar">
        <label className="search-field">
          <Package size={17} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Vorräte oder Barcodes durchsuchen" />
        </label>
        <span>{items.length} {items.length === 1 ? "Produkt" : "Produkte"}</span>
      </div>

      {visibleItems.length > 0 ? (
        <div className="pantry-grid">
          {visibleItems.map((item) => (
            <article className="pantry-card" key={item.id}>
              <div className="pantry-card-image">
                {item.image_url
                  ? <img src={item.image_url} alt={item.name} />
                  : <div className="pantry-image-placeholder"><Package size={34} /><span>Kein Produktbild</span></div>}
                <span className="pantry-quantity">{formatQuantity(item.quantity, item.unit)}</span>
              </div>
              <div className="pantry-card-content">
                <div>
                  <h2>{item.name}</h2>
                  {item.barcode && <p className="pantry-barcode"><ScanLine size={13} /> {item.barcode}</p>}
                </div>
                <div className="pantry-card-actions">
                  <button type="button" className="icon-button" aria-label={`${item.name} bearbeiten`} onClick={() => resetForm(item)} disabled={busy}>
                    <Pencil size={16} />
                  </button>
                  <button type="button" className="icon-button pantry-remove-button" aria-label={`${item.name} aus dem Vorrat entfernen`} onClick={() => void deleteItem(item)} disabled={busy}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-recipes pantry-empty">
          <span>🥫</span>
          <h2>{search ? "Kein Vorrat gefunden." : "Euer Vorrat ist noch leer."}</h2>
          <p>{search ? "Versuche einen anderen Suchbegriff." : "Fügt vorhandene Lebensmittel hinzu. Mampf verrechnet sie mit eurem Wochenplan."}</p>
          {!search && (
            <div className="pantry-empty-actions">
              <button className="button button-outline" onClick={() => setScannerOpen(true)}><ScanLine size={16} /> Barcode scannen</button>
              <button className="button button-primary" onClick={() => resetForm(null)}><Plus size={16} /> Erstes Produkt hinzufügen</button>
            </div>
          )}
        </div>
      )}

      {formOpen && (
        <div className="modal-backdrop pantry-form-backdrop" role="presentation" onClick={() => setFormOpen(false)}>
          <section className="pantry-form modal-card" role="dialog" aria-modal="true" aria-labelledby="pantry-form-title" onClick={(event) => event.stopPropagation()}>
            <div className="pantry-modal-heading">
              <div><p className="eyebrow">Gemeinsamer Haushalt</p><h2 id="pantry-form-title">{editingItem ? "Vorrat bearbeiten" : "Vorrat hinzufügen"}</h2></div>
              <button type="button" className="icon-button" onClick={() => setFormOpen(false)} aria-label="Schließen"><X size={20} /></button>
            </div>
            {pageError && <p className="pantry-inline-note" role="status">{pageError}</p>}
            <form onSubmit={submit}>
              <label className="field-label">
                Produktname
                <input autoFocus value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} placeholder="z. B. Hafermilch" />
              </label>
              <label className="field-label">
                Barcode
                <span className="pantry-barcode-input">
                  <input value={barcode} onChange={(event) => setBarcode(event.target.value)} maxLength={64} placeholder="Optional" />
                  <button type="button" className="button button-outline" onClick={() => setScannerOpen(true)} aria-label="Barcode scannen"><ScanLine size={17} /></button>
                </span>
              </label>
              <div className="pantry-quantity-row">
                <label className="field-label">
                  Vorhandene Menge
                  <input type="number" min="0" step="0.001" value={quantity} onChange={(event) => setQuantity(event.target.value)} required placeholder="z. B. 2" />
                </label>
                <label className="field-label">
                  Einheit
                  <select value={unit} onChange={(event) => setUnit(event.target.value)}>
                    <option value="">Einheit wählen</option>
                    {ingredientUnitGroups.map((group) => (
                      <optgroup key={group.label} label={group.label}>
                        {group.units.map((unit) => (
                          <option key={unit.value} value={unit.value}>{unit.label}</option>
                        ))}
                      </optgroup>
                    ))}
                    {unit && !commonIngredientUnits.has(unit) && <option value={unit}>{unit}</option>}
                  </select>
                </label>
              </div>
              <div className="pantry-photo-row">
                {hasPreviewImage && (
                  <img className="pantry-photo-preview" src={previewUrl || editingItem?.image_url || ""} alt="Vorschau des Produktbilds" />
                )}
                <div className="pantry-photo-controls">
                  <label className="button button-outline pantry-photo-button">
                    <ImagePlus size={17} /> {hasPreviewImage ? "Bild ändern" : "Bild hinzufügen"}
                    <input
                      ref={photoInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      capture="environment"
                      onChange={(event) => {
                        setImageFile(event.target.files?.[0] ?? null);
                        setRemoveImage(false);
                      }}
                    />
                  </label>
                  {hasPreviewImage && (
                    <button type="button" className="text-button pantry-remove-photo" onClick={() => {
                      setImageFile(null);
                      setRemoveImage(true);
                      if (photoInputRef.current) photoInputRef.current.value = "";
                    }}>Bild entfernen</button>
                  )}
                  <small>Foto aufnehmen oder aus der Mediathek wählen · maximal 8 MB</small>
                </div>
              </div>
              {formError && <p className="form-error" role="alert">{formError}</p>}
              <div className="form-actions">
                <button type="button" className="button button-quiet" onClick={() => setFormOpen(false)}>Abbrechen</button>
                <button type="submit" className="button button-primary" disabled={busy}>{busy ? "Wird gespeichert …" : "Vorrat speichern"}</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {scannerOpen && <BarcodeScanner onDetected={useScannedBarcode} onClose={() => setScannerOpen(false)} />}
    </div>
  );
}
