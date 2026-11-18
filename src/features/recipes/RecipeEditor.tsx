import { useEffect, useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { commonIngredientUnits, ingredientUnitGroups } from "../../lib/ingredient-units";
import { isPantryImageCandidate } from "../../lib/pantry-images";
import {
  normalizeRecipeStepDrafts,
  recipeStepsForSave,
  recipeStepsToDraft,
  type RecipeStepDraft,
  type RecipeStepDraftIngredient,
  type RecipeStepPayload,
} from "../../lib/recipe-steps";
import type { Recipe } from "../../types";

interface IngredientDraft {
  name: string;
  quantity: string;
  unit: string;
}

const emptyIngredient = (): IngredientDraft => ({ name: "", quantity: "", unit: "" });

function isEmptyIngredient(ingredient: IngredientDraft) {
  return !ingredient.name.trim() && !ingredient.quantity.trim() && !ingredient.unit.trim();
}

export interface RecipePayload {
  title: string;
  description: string;
  category: string;
  source_url: string;
  prep_minutes: string;
  servings: number;
  image_file: File | null;
  ingredients: Array<{ name: string; quantity: string | null; unit: string }>;
  steps: RecipeStepPayload[];
}

interface RecipeEditorProps {
  initial?: Recipe;
  busy: boolean;
  error?: string;
  onCancel: () => void;
  onSave: (payload: RecipePayload) => Promise<void>;
  onDelete?: () => Promise<void>;
}

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
      {ingredientUnitGroups.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.units.map((unit) => (
            <option key={unit.value} value={unit.value}>{unit.label}</option>
          ))}
        </optgroup>
      ))}
      {value && !commonIngredientUnits.has(value) && (
        <optgroup label="Bisherige Einheit">
          <option value={value}>{value}</option>
        </optgroup>
      )}
    </select>
  );
}

function initialIngredients(recipe?: Recipe): IngredientDraft[] {
  const savedIngredients = recipe?.recipe_ingredients
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((ingredient) => ({
      name: ingredient.name,
      quantity: ingredient.quantity === null ? "" : String(ingredient.quantity),
      unit: ingredient.unit,
    })) ?? [];
  return normalizeIngredientDrafts(savedIngredients).ingredients;
}

function normalizeIngredientDrafts(ingredients: IngredientDraft[]) {
  const populated = ingredients
    .map((ingredient, originalIndex) => ({ ingredient, originalIndex }))
    .filter(({ ingredient }) => !isEmptyIngredient(ingredient));
  return {
    ingredients: [...populated.map(({ ingredient }) => ingredient), emptyIngredient()],
    indexMap: new Map(populated.map(({ originalIndex }, index) => [originalIndex, index])),
  };
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
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState(initial?.image_url ?? "");
  const [draftIngredients, setDraftIngredients] = useState(ingredients);
  const [steps, setSteps] = useState<RecipeStepDraft[]>(() =>
    recipeStepsToDraft(
      initial?.recipe_steps ?? [],
      initial?.recipe_ingredients ?? [],
      ingredients,
    ),
  );
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (!imageFile) {
      setImagePreview(initial?.image_url ?? "");
      return;
    }
    const previewUrl = URL.createObjectURL(imageFile);
    setImagePreview(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [imageFile, initial?.image_url]);

  function applyIngredientDrafts(nextDrafts: IngredientDraft[]) {
    const normalized = normalizeIngredientDrafts(nextDrafts);
    setDraftIngredients(normalized.ingredients);
    setSteps((current) => current.map((step) => ({
      ...step,
      ingredients: step.ingredients.flatMap((stepIngredient) => {
        const ingredientIndex = normalized.indexMap.get(stepIngredient.ingredient_index);
        return ingredientIndex === undefined
          ? []
          : [{ ...stepIngredient, ingredient_index: ingredientIndex }];
      }),
    })));
  }

  function updateIngredient(index: number, patch: Partial<IngredientDraft>) {
    applyIngredientDrafts(draftIngredients.map((ingredient, ingredientIndex) =>
      ingredientIndex === index ? { ...ingredient, ...patch } : ingredient,
    ));
  }

  function removeIngredient(index: number) {
    applyIngredientDrafts(draftIngredients.filter((_, ingredientIndex) => ingredientIndex !== index));
  }

  function updateStep(index: number, patch: Partial<RecipeStepDraft>) {
    setSteps((current) =>
      normalizeRecipeStepDrafts(
        current.map((step, stepIndex) => (stepIndex === index ? { ...step, ...patch } : step)),
      ),
    );
  }

  function addStepIngredient(stepIndex: number) {
    if (!steps[stepIndex]?.instruction.trim()) return;
    const ingredientIndex = draftIngredients.findIndex((ingredient) => ingredient.name.trim());
    if (ingredientIndex < 0) return;
    const ingredient = draftIngredients[ingredientIndex];
    updateStep(stepIndex, {
      ingredients: [
        ...steps[stepIndex].ingredients,
        { ingredient_index: ingredientIndex, quantity: ingredient.quantity, unit: ingredient.unit },
      ],
    });
  }

  function updateStepIngredient(
    stepIndex: number,
    ingredientIndex: number,
    patch: Partial<RecipeStepDraftIngredient>,
  ) {
    updateStep(stepIndex, {
      ingredients: steps[stepIndex].ingredients.map((ingredient, index) =>
        index === ingredientIndex ? { ...ingredient, ...patch } : ingredient,
      ),
    });
  }

  function selectImage(file: File | null) {
    setFormError("");
    if (file && !isPantryImageCandidate(file)) {
      setFormError("Bitte wähle ein JPEG-, PNG-, WebP- oder GIF-Bild aus.");
      return;
    }
    setImageFile(file);
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
    const ingredientIndexMap = new Map(
      indexedIngredients.map((ingredient, index) => [ingredient.originalIndex, index]),
    );
    const cleanSteps = recipeStepsForSave(steps, ingredientIndexMap);

    if (!title.trim() || cleanIngredients.length === 0 || cleanSteps.length === 0) {
      setFormError("Bitte gib einen Titel, mindestens eine Zutat und einen Zubereitungsschritt ein.");
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
      image_file: imageFile,
      ingredients: cleanIngredients.map((ingredient) => ({
        name: ingredient.name,
        quantity: ingredient.quantity || null,
        unit: ingredient.unit,
      })),
      steps: cleanSteps,
    }).catch((error: unknown) => {
      setFormError(error instanceof Error ? error.message : "Das Rezept konnte nicht gespeichert werden.");
    });
  }

  return (
    <form className="recipe-editor" onSubmit={submit}>
      <div className="editor-heading">
        <div>
          <p className="eyebrow">Euer Kochbuch</p>
          <h2 id="recipe-editor-title">{initial ? "Rezept bearbeiten" : "Neues Rezept"}</h2>
        </div>
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
        <small className="field-help">Ohne Upload wird das Titelbild über Microlink abgerufen, zugeschnitten und privat gespeichert. Instagram und private Beiträge blockieren das teils; dann bitte das Bild hochladen.</small>
      </label>
      <label className="field-label">
        Rezeptbild hochladen
        <input
          type="file"
          accept="image/*"
          onChange={(event) => {
            selectImage(event.target.files?.[0] ?? null);
            event.target.value = "";
          }}
        />
        <small className="field-help">JPEG, PNG, WebP oder GIF. Ein hochgeladenes Bild ersetzt das Bild aus dem Rezeptlink.</small>
      </label>
      {imagePreview && (
        <div className="recipe-image-preview">
          <img src={imagePreview} alt="Vorschau des Rezeptbilds" />
          {imageFile && (
            <button type="button" className="text-button danger-text" onClick={() => selectImage(null)}>
              <Trash2 size={15} /> Auswahl entfernen
            </button>
          )}
        </div>
      )}

      <section className="editor-section">
        <div className="section-title-row">
          <div>
            <h3>Zutaten</h3>
            <p>Die Mengen beziehen sich auf vier Portionen. Unten bleibt immer eine leere Zeile für die nächste Zutat.</p>
          </div>
        </div>
        {draftIngredients.map((ingredient, index) => (
          <div className="ingredient-edit-row" key={`ingredient-${index}`}>
            <input
              className="ingredient-name"
              aria-label={`Zutat ${index + 1}`}
              placeholder={index === draftIngredients.length - 1 ? "Weitere Zutat" : "Zutat"}
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
              disabled={draftIngredients.length === 1 || isEmptyIngredient(ingredient)}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </section>

      <section className="editor-section">
        <div className="section-title-row">
          <div>
            <h3>Zubereitung</h3>
            <p>Nach dem Ausfüllen eines Schritts erscheint automatisch der nächste. Ordne jedem Schritt die verwendeten Zutaten und Mengen zu.</p>
          </div>
        </div>
        {steps.map((step, stepIndex) => (
          <div className="step-edit-card" key={`step-${stepIndex}`}>
            <div className="step-edit-heading">
              <strong>Schritt {stepIndex + 1}</strong>
              <button
                type="button"
                className="text-button danger-text"
                onClick={() => setSteps((current) =>
                  normalizeRecipeStepDrafts(current.filter((_, index) => index !== stepIndex)),
                )}
                disabled={stepIndex === steps.length - 1}
              >
                <Trash2 size={15} /> Entfernen
              </button>
            </div>
            <textarea
              aria-label={`Anleitung Schritt ${stepIndex + 1}`}
              rows={3}
              placeholder={stepIndex === steps.length - 1 ? "Nächster Schritt" : "Was passiert in diesem Schritt?"}
              value={step.instruction}
              onChange={(event) => updateStep(stepIndex, { instruction: event.target.value })}
              maxLength={3000}
            />
            {step.ingredients.map((stepIngredient, linkIndex) => (
              <div className="ingredient-edit-row step-ingredient-row" key={`step-${stepIndex}-ingredient-${linkIndex}`}>
                <select
                  className="ingredient-name"
                  aria-label={`Zutat in Schritt ${stepIndex + 1}`}
                  value={stepIngredient.ingredient_index}
                  onChange={(event) => {
                    const ingredientIndex = Number(event.target.value);
                    const base = draftIngredients[ingredientIndex];
                    updateStepIngredient(stepIndex, linkIndex, {
                      ingredient_index: ingredientIndex,
                      quantity: base?.quantity ?? "",
                      unit: base?.unit ?? "",
                    });
                  }}
                >
                  {draftIngredients.flatMap((ingredient, ingredientIndex) =>
                    ingredient.name.trim()
                      ? <option key={ingredientIndex} value={ingredientIndex}>{ingredient.name}</option>
                      : [],
                  )}
                </select>
                <input
                  className="ingredient-quantity"
                  aria-label={`Menge der Schrittzutat ${linkIndex + 1}`}
                  type="number"
                  min="0"
                  step="0.001"
                  placeholder="Menge"
                  value={stepIngredient.quantity}
                  onChange={(event) => updateStepIngredient(stepIndex, linkIndex, { quantity: event.target.value })}
                />
                <UnitSelect
                  className="ingredient-unit-select"
                  label={`Einheit der Schrittzutat ${linkIndex + 1}`}
                  value={stepIngredient.unit}
                  onChange={(unit) => updateStepIngredient(stepIndex, linkIndex, { unit })}
                />
                <button
                  type="button"
                  className="icon-button subtle ingredient-remove"
                  aria-label={`Schrittzutat ${linkIndex + 1} entfernen`}
                  onClick={() => updateStep(stepIndex, {
                    ingredients: step.ingredients.filter((_, index) => index !== linkIndex),
                  })}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="text-button"
              onClick={() => addStepIngredient(stepIndex)}
              disabled={!step.instruction.trim() || !draftIngredients.some((ingredient) => ingredient.name.trim())}
            >
              <Plus size={15} /> Zutat für diesen Schritt
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
