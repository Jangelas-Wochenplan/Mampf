import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { Recipe } from "../../types";

interface IngredientDraft {
  name: string;
  quantity: string;
  unit: string;
}

interface StepIngredientDraft {
  ingredient_index: number;
  quantity: string;
  unit: string;
}

interface StepDraft {
  instruction: string;
  ingredients: StepIngredientDraft[];
}

export interface RecipePayload {
  title: string;
  description: string;
  prep_minutes: string;
  servings: number;
  emoji: string;
  ingredients: Array<{ name: string; quantity: string | null; unit: string }>;
  steps: Array<{
    instruction: string;
    ingredients: StepIngredientDraft[];
  }>;
}

interface RecipeEditorProps {
  initial?: Recipe;
  busy: boolean;
  onCancel: () => void;
  onSave: (payload: RecipePayload) => Promise<void>;
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

function initialSteps(recipe?: Recipe, ingredients = initialIngredients(recipe)): StepDraft[] {
  if (!recipe) return [{ instruction: "", ingredients: [] }];
  const ingredientIndexes = new Map(
    recipe.recipe_ingredients.map((ingredient, index) => [ingredient.id, index]),
  );
  return recipe.recipe_steps
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((step) => ({
      instruction: step.instruction,
      ingredients: step.step_ingredients
        .map((stepIngredient) => {
          const ingredientIndex = ingredientIndexes.get(stepIngredient.recipe_ingredient_id);
          if (ingredientIndex === undefined) return null;
          const base = ingredients[ingredientIndex];
          return {
            ingredient_index: ingredientIndex,
            quantity:
              stepIngredient.quantity === null
                ? base.quantity
                : String(stepIngredient.quantity),
            unit: stepIngredient.unit || base.unit,
          };
        })
        .filter((entry): entry is StepIngredientDraft => entry !== null),
    }));
}

export default function RecipeEditor({ initial, busy, onCancel, onSave }: RecipeEditorProps) {
  const ingredients = initialIngredients(initial);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [prepMinutes, setPrepMinutes] = useState(
    initial?.prep_minutes === null || initial?.prep_minutes === undefined
      ? ""
      : String(initial.prep_minutes),
  );
  const [emoji, setEmoji] = useState(initial?.emoji ?? "🍲");
  const [draftIngredients, setDraftIngredients] = useState(ingredients);
  const [steps, setSteps] = useState(() => initialSteps(initial, ingredients));
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
    setSteps((current) =>
      current.map((step) => ({
        ...step,
        ingredients: step.ingredients
          .filter((ingredient) => ingredient.ingredient_index !== index)
          .map((ingredient) => ({
            ...ingredient,
            ingredient_index: ingredient.ingredient_index > index
              ? ingredient.ingredient_index - 1
              : ingredient.ingredient_index,
          })),
      })),
    );
  }

  function updateStep(index: number, patch: Partial<StepDraft>) {
    setSteps((current) =>
      current.map((step, stepIndex) => (stepIndex === index ? { ...step, ...patch } : step)),
    );
  }

  function addStepIngredient(stepIndex: number) {
    if (draftIngredients.length === 0) return;
    const ingredient = draftIngredients[0];
    updateStep(stepIndex, {
      ingredients: [
        ...steps[stepIndex].ingredients,
        { ingredient_index: 0, quantity: ingredient.quantity, unit: ingredient.unit },
      ],
    });
  }

  function updateStepIngredient(
    stepIndex: number,
    ingredientIndex: number,
    patch: Partial<StepIngredientDraft>,
  ) {
    const next = steps[stepIndex].ingredients.map((ingredient, index) =>
      index === ingredientIndex ? { ...ingredient, ...patch } : ingredient,
    );
    updateStep(stepIndex, { ingredients: next });
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
    const ingredientIndexMap = new Map(
      indexedIngredients.map((ingredient, index) => [ingredient.originalIndex, index]),
    );
    const cleanIngredients = indexedIngredients.map((ingredient) => ({
      name: ingredient.name,
      quantity: ingredient.quantity,
      unit: ingredient.unit,
    }));
    const cleanSteps = steps
      .map((step) => ({
        instruction: step.instruction.trim(),
        ingredients: step.ingredients,
      }))
      .filter((step) => step.instruction);

    if (!title.trim() || cleanIngredients.length === 0 || cleanSteps.length === 0) {
      setFormError("Bitte gib einen Titel, mindestens eine Zutat und einen Zubereitungsschritt ein.");
      return;
    }

    await onSave({
      title: title.trim(),
      description: description.trim(),
      prep_minutes: prepMinutes.trim(),
      servings: 4,
      emoji,
      ingredients: cleanIngredients.map((ingredient) => ({
        name: ingredient.name,
        quantity: ingredient.quantity || null,
        unit: ingredient.unit,
      })),
      steps: cleanSteps.map((step) => ({
        instruction: step.instruction,
        ingredients: step.ingredients.flatMap((ingredient) => {
          const ingredientIndex = ingredientIndexMap.get(ingredient.ingredient_index);
          if (ingredientIndex === undefined) return [];
          return [{
            ...ingredient,
            ingredient_index: ingredientIndex,
            quantity: ingredient.quantity.trim(),
            unit: ingredient.unit.trim(),
          }];
        }),
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
              aria-label={`Zutat ${index + 1}`}
              placeholder="Zutat"
              value={ingredient.name}
              onChange={(event) => updateIngredient(index, { name: event.target.value })}
            />
            <input
              aria-label={`Menge für Zutat ${index + 1}`}
              type="number"
              min="0"
              step="0.001"
              placeholder="Menge"
              value={ingredient.quantity}
              onChange={(event) => updateIngredient(index, { quantity: event.target.value })}
            />
            <input
              aria-label={`Einheit für Zutat ${index + 1}`}
              placeholder="Einheit"
              value={ingredient.unit}
              onChange={(event) => updateIngredient(index, { unit: event.target.value })}
            />
            <button
              type="button"
              className="icon-button subtle"
              aria-label={`Zutat ${index + 1} entfernen`}
              onClick={() => removeIngredient(index)}
              disabled={draftIngredients.length === 1}
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
            <p>Ordne jedem Schritt die verwendeten Zutaten und Mengen zu.</p>
          </div>
          <button
            type="button"
            className="text-button"
            onClick={() => setSteps((current) => [...current, { instruction: "", ingredients: [] }])}
          >
            <Plus size={16} /> Schritt
          </button>
        </div>
        {steps.map((step, stepIndex) => (
          <div className="step-edit-card" key={`step-${stepIndex}`}>
            <div className="step-edit-heading">
              <strong>Schritt {stepIndex + 1}</strong>
              <button
                type="button"
                className="text-button danger-text"
                onClick={() => setSteps((current) => current.filter((_, index) => index !== stepIndex))}
                disabled={steps.length === 1}
              >
                <Trash2 size={15} /> Entfernen
              </button>
            </div>
            <textarea
              aria-label={`Anleitung Schritt ${stepIndex + 1}`}
              rows={3}
              placeholder="Was passiert in diesem Schritt?"
              value={step.instruction}
              onChange={(event) => updateStep(stepIndex, { instruction: event.target.value })}
            />
            {step.ingredients.map((stepIngredient, linkIndex) => (
              <div className="ingredient-edit-row step-ingredient-row" key={`step-${stepIndex}-ingredient-${linkIndex}`}>
                <select
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
                  {draftIngredients.map((ingredient, ingredientIndex) => (
                    <option key={ingredientIndex} value={ingredientIndex}>
                      {ingredient.name || `Zutat ${ingredientIndex + 1}`}
                    </option>
                  ))}
                </select>
                <input
                  aria-label="Schrittmenge"
                  type="number"
                  min="0"
                  step="0.001"
                  placeholder="Menge"
                  value={stepIngredient.quantity}
                  onChange={(event) => updateStepIngredient(stepIndex, linkIndex, { quantity: event.target.value })}
                />
                <input
                  aria-label="Einheit"
                  placeholder="Einheit"
                  value={stepIngredient.unit}
                  onChange={(event) => updateStepIngredient(stepIndex, linkIndex, { unit: event.target.value })}
                />
                <button
                  type="button"
                  className="icon-button subtle"
                  aria-label="Schrittzutat entfernen"
                  onClick={() =>
                    updateStep(stepIndex, {
                      ingredients: step.ingredients.filter((_, index) => index !== linkIndex),
                    })
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            <button type="button" className="text-button" onClick={() => addStepIngredient(stepIndex)}>
              <Plus size={15} /> Zutat für diesen Schritt
            </button>
          </div>
        ))}
      </section>

      {formError && <p className="form-error" role="alert">{formError}</p>}
      <div className="form-actions">
        <button type="button" className="button button-quiet" onClick={onCancel}>Abbrechen</button>
        <button type="submit" className="button button-primary" disabled={busy}>
          {busy ? "Wird gespeichert …" : initial ? "Änderungen speichern" : "Rezept speichern"}
        </button>
      </div>
    </form>
  );
}
