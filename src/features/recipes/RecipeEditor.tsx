import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { Recipe } from "../../types";

interface IngredientDraft {
  name: string;
  quantity: string;
  unit: string;
}

export interface RecipePayload {
  title: string;
  description: string;
  category: string;
  source_url: string;
  prep_minutes: string;
  servings: number;
  emoji: string;
  ingredients: Array<{ name: string; quantity: string | null; unit: string }>;
}

interface RecipeEditorProps {
  initial?: Recipe;
  busy: boolean;
  error?: string;
  onCancel: () => void;
  onSave: (payload: RecipePayload) => Promise<void>;
  onDelete?: () => Promise<void>;
}

const unitGroups = [
  {
    label: "Gewicht",
    units: [
      { value: "g", label: "Gramm (g)" },
      { value: "kg", label: "Kilogramm (kg)" },
    ],
  },
  {
    label: "Volumen",
    units: [
      { value: "ml", label: "Milliliter (ml)" },
      { value: "l", label: "Liter (l)" },
    ],
  },
  {
    label: "Kochmaße",
    units: [
      { value: "TL", label: "Teelöffel (TL)" },
      { value: "EL", label: "Esslöffel (EL)" },
      { value: "Tasse", label: "Tasse" },
      { value: "Prise", label: "Prise" },
      { value: "Spritzer", label: "Spritzer" },
      { value: "Handvoll", label: "Handvoll" },
    ],
  },
  {
    label: "Stück und Packungen",
    units: [
      { value: "Stück", label: "Stück" },
      { value: "Bund", label: "Bund" },
      { value: "Zehe", label: "Zehe" },
      { value: "Dose", label: "Dose" },
      { value: "Packung", label: "Packung" },
      { value: "Päckchen", label: "Päckchen" },
      { value: "Scheibe", label: "Scheibe" },
      { value: "Blatt", label: "Blatt" },
      { value: "Stange", label: "Stange" },
      { value: "Kopf", label: "Kopf" },
      { value: "Flasche", label: "Flasche" },
      { value: "Glas", label: "Glas" },
      { value: "Becher", label: "Becher" },
      { value: "Zweig", label: "Zweig" },
      { value: "Portion", label: "Portion" },
    ],
  },
];

const commonUnits = new Set(unitGroups.flatMap((group) => group.units.map((unit) => unit.value)));

function UnitSelect({
  label,
  value,
  onChange,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <select className={className} aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">Einheit wählen</option>
      {unitGroups.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.units.map((unit) => (
            <option key={unit.value} value={unit.value}>{unit.label}</option>
          ))}
        </optgroup>
      ))}
      {value && !commonUnits.has(value) && (
        <optgroup label="Bisherige Einheit">
          <option value={value}>{value}</option>
        </optgroup>
      )}
    </select>
  );
}

function initialIngredients(recipe?: Recipe): IngredientDraft[] {
  return recipe?.recipe_ingredients
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((ingredient) => ({
      name: ingredient.name,
      quantity: ingredient.quantity === null ? "" : String(ingredient.quantity),
      unit: ingredient.unit,
    })) ?? [{ name: "", quantity: "", unit: "" }];
}

export default function RecipeEditor({ initial, busy, error, onCancel, onSave, onDelete }: RecipeEditorProps) {
  const ingredients = initialIngredients(initial);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [sourceUrl, setSourceUrl] = useState(initial?.source_url ?? "");
  const [prepMinutes, setPrepMinutes] = useState(
    initial?.prep_minutes === null || initial?.prep_minutes === undefined
      ? ""
      : String(initial.prep_minutes),
  );
  const [emoji, setEmoji] = useState(initial?.emoji ?? "🍲");
  const [draftIngredients, setDraftIngredients] = useState(ingredients);
  const [formError, setFormError] = useState("");

  function updateIngredient(index: number, patch: Partial<IngredientDraft>) {
    setDraftIngredients((current) =>
      current.map((ingredient, ingredientIndex) =>
        ingredientIndex === index ? { ...ingredient, ...patch } : ingredient,
      ),
    );
  }

  function removeIngredient(index: number) {
    setDraftIngredients((current) => current.filter((_, ingredientIndex) => ingredientIndex !== index));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    const indexedIngredients = draftIngredients
      .map((ingredient, originalIndex) => ({
        originalIndex,
        ...ingredient,
        name: ingredient.name.trim(),
        quantity: ingredient.quantity.trim(),
        unit: ingredient.unit.trim(),
      }))
      .filter((ingredient) => ingredient.name);
    const cleanIngredients = indexedIngredients.map((ingredient) => ({
      name: ingredient.name,
      quantity: ingredient.quantity,
      unit: ingredient.unit,
    }));

    if (!title.trim() || cleanIngredients.length === 0) {
      setFormError("Bitte gib einen Titel und mindestens eine Zutat ein.");
      return;
    }
    if (sourceUrl.trim()) {
      try {
        const url = new URL(sourceUrl.trim());
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
          throw new Error("invalid recipe link");
        }
      } catch {
        setFormError("Bitte gib einen gültigen HTTP- oder HTTPS-Link zum Rezept ein.");
        return;
      }
    }

    await onSave({
      title: title.trim(),
      description: description.trim(),
      category: category.trim(),
      source_url: sourceUrl.trim(),
      prep_minutes: prepMinutes.trim(),
      servings: 4,
      emoji,
      ingredients: cleanIngredients.map((ingredient) => ({
        name: ingredient.name,
        quantity: ingredient.quantity || null,
        unit: ingredient.unit,
      })),
    }).catch((error: unknown) => {
      setFormError(error instanceof Error ? error.message : "Das Rezept konnte nicht gespeichert werden.");
    });
  }

  return (
    <form className="recipe-editor" onSubmit={submit}>
      <div className="editor-heading">
        <div>
          <p className="eyebrow">Euer Kochbuch</p>
          <h2>{initial ? "Rezept bearbeiten" : "Neues Rezept"}</h2>
        </div>
        <button type="button" className="icon-button" onClick={onCancel} aria-label="Schließen">
          ×
        </button>
      </div>
      <label className="field-label">
        Rezeptname
        <input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={120} />
      </label>
      <div className="field-grid">
        <label className="field-label">
          Kurzbeschreibung
          <input value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>
        <label className="field-label">
          Zeit in Minuten
          <input
            type="number"
            min="1"
            value={prepMinutes}
            onChange={(event) => setPrepMinutes(event.target.value)}
            placeholder="z. B. 30"
          />
        </label>
      </div>
      <label className="field-label">
        Kategorie
        <input
          list="recipe-category-suggestions"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          placeholder="z. B. Lieblingsessen"
          maxLength={50}
        />
        <datalist id="recipe-category-suggestions">
          {["Lieblingsessen", "Ausprobieren", "Sonntagsessen", "Schnell & einfach", "Vegetarisch", "Familienklassiker"].map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
      </label>
      <label className="field-label">
        Link zum Rezept
        <input
          type="url"
          inputMode="url"
          autoComplete="url"
          value={sourceUrl}
          onChange={(event) => setSourceUrl(event.target.value)}
          placeholder="https://beispiel.de/rezept"
          maxLength={2048}
        />
        <small className="field-help">Ein öffentliches Titelbild wird beim Speichern automatisch übernommen.</small>
      </label>
      <label className="field-label">
        Karten-Symbol
        <select value={emoji} onChange={(event) => setEmoji(event.target.value)}>
          {["🍲", "🍝", "🥗", "🍛", "🥘", "🍜", "🌮", "🍕", "🥔"].map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
      </label>

      <section className="editor-section">
        <div className="section-title-row">
          <div>
            <h3>Zutaten</h3>
            <p>Die Mengen beziehen sich auf vier Portionen.</p>
          </div>
          <button
            type="button"
            className="text-button"
            onClick={() => setDraftIngredients((current) => [...current, { name: "", quantity: "", unit: "" }])}
          >
            <Plus size={16} /> Zutat
          </button>
        </div>
        {draftIngredients.map((ingredient, index) => (
          <div className="ingredient-edit-row" key={`ingredient-${index}`}>
            <input
              className="ingredient-name"
              aria-label={`Zutat ${index + 1}`}
              placeholder="Zutat"
              value={ingredient.name}
              onChange={(event) => updateIngredient(index, { name: event.target.value })}
            />
            <input
              className="ingredient-quantity"
              aria-label={`Menge für Zutat ${index + 1}`}
              type="number"
              min="0"
              step="0.001"
              placeholder="Menge"
              value={ingredient.quantity}
              onChange={(event) => updateIngredient(index, { quantity: event.target.value })}
            />
            <UnitSelect
              className="ingredient-unit-select"
              label={`Einheit für Zutat ${index + 1}`}
              value={ingredient.unit}
              onChange={(unit) => updateIngredient(index, { unit })}
            />
            <button
              type="button"
              className="icon-button subtle ingredient-remove"
              aria-label={`Zutat ${index + 1} entfernen`}
              onClick={() => removeIngredient(index)}
              disabled={draftIngredients.length === 1}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </section>

      {(formError || error) && <p className="form-error" role="alert">{formError || error}</p>}
      <div className="form-actions">
        {initial && onDelete && (
          <button type="button" className="button button-quiet danger-text recipe-delete-button" onClick={() => void onDelete()} disabled={busy}>
            <Trash2 size={16} /> Gericht löschen
          </button>
        )}
        <button type="button" className="button button-quiet" onClick={onCancel}>Abbrechen</button>
        <button type="submit" className="button button-primary" disabled={busy}>
          {busy ? "Wird gespeichert …" : initial ? "Änderungen speichern" : "Rezept speichern"}
        </button>
      </div>
    </form>
  );
}
