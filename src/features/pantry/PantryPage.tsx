import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ImagePlus, Package, Pencil, Plus, ScanLine, Trash2, X } from "lucide-react";
import { formatQuantity } from "../../lib/format";
import { commonIngredientUnits, ingredientUnitGroups } from "../../lib/ingredient-units";
import { pantryErrorMessage } from "../../lib/pantry-errors";
import { isPantryImageCandidate } from "../../lib/pantry-images";
import type { PantryItem } from "../../types";
import BarcodeScanner from "./BarcodeScanner";

export interface PantryItemSaveInput {
  id: string | null;
  name: string;
  category: string;
  barcode: string;
  quantity: number;
  unit: string;
  imageFile: File | null;
  removeImage: boolean;
  addToExisting: boolean;
}

interface PantryPageProps {
  items: PantryItem[];
  busy: boolean;
  onFindByBarcode: (barcode: string) => Promise<PantryItem | null>;
  onSave: (item: PantryItemSaveInput) => Promise<void>;
  onDelete: (item: PantryItem) => Promise<void>;
}

const DEFAULT_CATEGORIES = [
  "Gemüse",
  "Obst",
  "Milchprodukte",
  "Fleisch & Fisch",
  "Konserven",
  "Nudeln & Reis",
  "Backzutaten",
  "Gewürze",
  "Getränke",
  "Tiefkühl",
  "Sonstiges",
];

export default function PantryPage({ items, busy, onFindByBarcode, onSave, onDelete }: PantryPageProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<PantryItem | null>(null);
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [barcode, setBarcode] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [addingToExisting, setAddingToExisting] = useState(false);
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
      `${item.name} ${item.category} ${item.barcode}`.toLocaleLowerCase("de-DE").includes(needle),
    );
  }, [items, search]);
  const categories = useMemo(() => {
    const savedCategories = items.map((item) => item.category.trim()).filter(Boolean);
    return Array.from(new Set([...DEFAULT_CATEGORIES, ...savedCategories]));
  }, [items]);
  const hasPreviewImage = Boolean(previewUrl || (!removeImage && editingItem?.image_url));

  function resetForm(item: PantryItem | null) {
    setEditingItem(item);
    setName(item?.name ?? "");
    setCategory(item?.category ?? "");
    setBarcode(item?.barcode ?? "");
    setQuantity(item ? String(item.quantity) : "");
    setUnit(item?.unit ?? "");
    setAddingToExisting(false);
    setImageFile(null);
    setRemoveImage(false);
    setFormError("");
    setPageError("");
    if (photoInputRef.current) photoInputRef.current.value = "";
    setFormOpen(true);
  }

  async function useScannedBarcode(scannedBarcode: string) {
    setScannerOpen(false);
    try {
      const existing = await onFindByBarcode(scannedBarcode);
      resetForm(existing);
      if (existing) {
        setQuantity("");
        setAddingToExisting(true);
        setPageError(`„${existing.name}“ ist bereits im Vorrat (${formatQuantity(existing.quantity, existing.unit)}). Die gescannte Menge wird beim Speichern addiert.`);
      }
      setBarcode(scannedBarcode);
    } catch (reason) {
      setPageError(pantryErrorMessage(reason));
    }
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
    if (addingToExisting && parsedQuantity <= 0) {
      setFormError("Bitte gib eine zugekaufte Menge größer als 0 ein.");
      return;
    }
    if (imageFile && imageFile.size > 40 * 1024 * 1024) {
      setFormError("Das Bild darf höchstens 40 MB groß sein.");
      return;
    }
    if (imageFile && !isPantryImageCandidate(imageFile)) {
      setFormError("Bitte wähle ein JPEG-, PNG-, WebP- oder GIF-Bild aus.");
      return;
    }
    try {
      await onSave({
        id: editingItem?.id ?? null,
        name: name.trim(),
        category: category.trim(),
        barcode: barcode.trim(),
        quantity: parsedQuantity,
        unit,
        imageFile,
        removeImage,
        addToExisting: addingToExisting,
      });
      setFormOpen(false);
      setPageError("");
      if (photoInputRef.current) photoInputRef.current.value = "";
    } catch (reason) {
      setFormError(pantryErrorMessage(reason));
    }
  }

  async function deleteItem(item: PantryItem) {
    if (!window.confirm(`„${item.name}“ aus dem Vorrat entfernen?`)) return;
    setPageError("");
    try {
      await onDelete(item);
      if (editingItem?.id === item.id) setFormOpen(false);
    } catch (reason) {
      setPageError(pantryErrorMessage(reason));
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
                  {item.category && <span className="pantry-category-tag">{item.category}</span>}
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
                Kategorie
                <input list="pantry-category-options" value={category} onChange={(event) => setCategory(event.target.value)} maxLength={60} placeholder="z. B. Gemüse" />
                <datalist id="pantry-category-options">
                  {categories.map((option) => <option key={option} value={option} />)}
                </datalist>
                <small>Vorschläge auswählen oder eine eigene Kategorie eingeben.</small>
              </label>
              <label className="field-label">
                Barcode
                <span className={`pantry-barcode-input${barcode ? " has-clear" : ""}`}>
                  <input value={barcode} onChange={(event) => setBarcode(event.target.value)} maxLength={64} placeholder="Optional" />
                  <button type="button" className="button button-outline" onClick={() => setScannerOpen(true)} aria-label="Barcode scannen"><ScanLine size={17} /></button>
                  {barcode && <button type="button" className="icon-button pantry-barcode-clear" onClick={() => setBarcode("")} aria-label="Barcode entfernen"><X size={17} /></button>}
                </span>
              </label>
              <div className="pantry-quantity-row">
                <label className="field-label">
                  {addingToExisting ? "Zugekaufte Menge" : "Vorhandene Menge"}
                  <input type="number" min="0" step="0.001" value={quantity} onChange={(event) => setQuantity(event.target.value)} required placeholder="z. B. 2" />
                </label>
                <label className="field-label">
                  Einheit
                  <select value={unit} onChange={(event) => setUnit(event.target.value)} disabled={addingToExisting}>
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
              {addingToExisting && <p className="pantry-inline-note">Die neue Menge wird in {unit || "derselben Einheit"} zum vorhandenen Bestand addiert.</p>}
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
                      accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,.heic,.heif"
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
                  <small>Foto aufnehmen oder auswählen · große Fotos werden verkleinert, HEIC wird umgewandelt</small>
                </div>
              </div>
              {formError && <p className="form-error" role="alert">{formError}</p>}
              <div className="form-actions">
                {editingItem && <button type="button" className="button button-outline pantry-delete-button" onClick={() => void deleteItem(editingItem)} disabled={busy}><Trash2 size={16} /> Vorrat löschen</button>}
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
