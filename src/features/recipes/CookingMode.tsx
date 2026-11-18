import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import type { Recipe } from "../../types";
import RecipeArtwork from "./RecipeArtwork";

interface CookingModeProps {
  recipe: Recipe;
  onClose: () => void;
}

function scaledAmount(quantity: number | null, servings: number, unit: string): string {
  if (quantity === null) return "nach Bedarf";
  const amount = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(
    quantity * (servings / recipeBaseServings),
  );
  return `${amount}${unit ? ` ${unit}` : ""}`;
}

const recipeBaseServings = 4;

export default function CookingMode({ recipe, onClose }: CookingModeProps) {
  const [stepIndex, setStepIndex] = useState(0);
  const [servings, setServings] = useState(4);
  const [done, setDone] = useState(false);
  const steps = recipe.recipe_steps.slice().sort((a, b) => a.position - b.position);
  const step = steps[stepIndex];
  const progress = steps.length ? ((stepIndex + 1) / steps.length) * 100 : 100;

  return (
    <div className="cooking-overlay" role="dialog" aria-modal="true" aria-label="Kochmodus">
      <header className="cooking-topbar">
        <div className="cooking-brand"><span className="brand-mark">m</span><span>Kochmodus</span></div>
        <div className="cooking-recipe-name">
          <RecipeArtwork className="cooking-recipe-thumb" imageUrl={recipe.image_url} emoji={recipe.emoji} />
          <span>{recipe.title}</span>
        </div>
        <button className="icon-button cooking-close" onClick={onClose} aria-label="Kochmodus schließen">
          <X size={20} />
        </button>
      </header>
      {!done ? (
        <main className="cooking-content">
          <div className="cooking-progress-label">
            <span>Schritt {stepIndex + 1} von {steps.length}</span>
            <label>
              Portionen
              <select value={servings} onChange={(event) => setServings(Number(event.target.value))}>
                {[1, 2, 3, 4, 5, 6, 8, 10, 12].map((count) => <option key={count}>{count}</option>)}
              </select>
            </label>
          </div>
          <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
          <div className="cooking-step-number">{String(stepIndex + 1).padStart(2, "0")}</div>
          <p className="eyebrow">Jetzt wird gekocht</p>
          <h1>{step?.instruction ?? "Alles bereit!"}</h1>
          {step && step.step_ingredients.length > 0 && (
            <section className="step-ingredients">
              <h2>Für diesen Schritt</h2>
              <div className="step-ingredient-pills">
                {step.step_ingredients.map((item) => (
                  <span key={item.id}>
                    <strong>{scaledAmount(item.quantity, servings, item.unit)}</strong>
                    {" "}{item.recipe_ingredient?.name ?? "Zutat"}
                  </span>
                ))}
              </div>
            </section>
          )}
          <div className="cooking-navigation">
            <button
              className="button button-quiet"
              onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
              disabled={stepIndex === 0}
            >
              <ArrowLeft size={17} /> Zurück
            </button>
            {stepIndex < steps.length - 1 ? (
              <button className="button button-primary" onClick={() => setStepIndex((current) => current + 1)}>
                Nächster Schritt <ArrowRight size={17} />
              </button>
            ) : (
              <button className="button button-primary" onClick={() => setDone(true)}>
                Fertig kochen <Check size={17} />
              </button>
            )}
          </div>
        </main>
      ) : (
        <main className="cooking-content cooking-finished">
          <div className="finished-mark"><Check size={34} /></div>
          <p className="eyebrow">Guten Appetit</p>
          <h1>Das sieht nach einem guten Essen aus.</h1>
          <p>{recipe.title} ist fertig. Lasst es euch schmecken!</p>
          <button className="button button-primary" onClick={onClose}>Zurück zum Wochenplan</button>
        </main>
      )}
    </div>
  );
}
