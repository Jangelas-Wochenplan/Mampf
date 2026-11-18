import { useState } from "react";
import { Clock3, CookingPot, Pencil, X } from "lucide-react";
import type { Recipe } from "../../types";
import { formatQuantity } from "../../lib/format";

interface RecipeDetailProps {
  recipe: Recipe;
  onClose: () => void;
  onEdit: () => void;
  onCook: () => void;
}

export default function RecipeDetail({ recipe, onClose, onEdit, onCook }: RecipeDetailProps) {
  const [servings, setServings] = useState(4);
  const ingredients = recipe.recipe_ingredients.slice().sort((a, b) => a.sort_order - b.sort_order);
  const steps = recipe.recipe_steps.slice().sort((a, b) => a.position - b.position);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <article
        className="recipe-detail modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recipe-detail-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button className="icon-button detail-close" onClick={onClose} aria-label="Schließen"><X size={20} /></button>
        <div className="detail-hero">
          <div className="recipe-art detail-art">{recipe.emoji}</div>
          <div>
            <p className="eyebrow">Aus eurem Kochbuch</p>
            <h2 id="recipe-detail-title">{recipe.title}</h2>
            <p>{recipe.description || "Ein Lieblingsessen für die ganze Runde."}</p>
            {recipe.prep_minutes && <span className="meta-pill"><Clock3 size={15} /> {recipe.prep_minutes} Min.</span>}
          </div>
        </div>
        <div className="detail-columns">
          <section>
            <div className="section-title-row">
              <div><h3>Zutaten</h3><p>Auf eure Portionen angepasst</p></div>
              <label className="servings-control">
                <select value={servings} onChange={(event) => setServings(Number(event.target.value))}>
                  {[1, 2, 3, 4, 5, 6, 8, 10, 12].map((count) => <option key={count} value={count}>{count}</option>)}
                </select>
                Portionen
              </label>
            </div>
            <ul className="ingredient-list">
              {ingredients.map((ingredient) => (
                <li key={ingredient.id}>
                  <span>{ingredient.name}</span>
                  <strong>{formatQuantity(ingredient.quantity, ingredient.unit, servings)}</strong>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <div className="section-title-row">
              <div><h3>So geht’s</h3><p>{steps.length} einfache Schritte</p></div>
            </div>
            <ol className="detail-step-list">
              {steps.map((step, index) => (
                <li key={step.id}>
                  <span className="step-count">{index + 1}</span>
                  <div>
                    <p>{step.instruction}</p>
                    {step.step_ingredients.length > 0 && (
                      <small>
                        {step.step_ingredients.map((item) =>
                          `${formatQuantity(item.quantity, item.unit, servings)} ${item.recipe_ingredient?.name ?? ""}`.trim(),
                        ).join(" · ")}
                      </small>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>
        <div className="detail-actions">
          <button className="button button-quiet" onClick={onEdit}><Pencil size={16} /> Rezept bearbeiten</button>
          <button className="button button-primary" onClick={onCook}><CookingPot size={17} /> Kochmodus starten</button>
        </div>
      </article>
    </div>
  );
}
