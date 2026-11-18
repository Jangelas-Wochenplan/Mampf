import { useState } from "react";
import { Check, CookingPot, X } from "lucide-react";
import type { Recipe } from "../../types";
import { formatQuantity } from "../../lib/format";
import { recipePreparationText } from "../../lib/recipe-preparation";
import RecipeArtwork from "./RecipeArtwork";

interface CookingModeProps {
  recipe: Recipe;
  onClose: () => void;
}

export default function CookingMode({ recipe, onClose }: CookingModeProps) {
  const [servings, setServings] = useState(4);
  const [checkedIngredients, setCheckedIngredients] = useState<Set<string>>(() => new Set());
  const ingredients = recipe.recipe_ingredients.slice().sort((a, b) => a.sort_order - b.sort_order);
  const preparation = recipePreparationText(recipe.recipe_steps);
  const allChecked = ingredients.length > 0 && checkedIngredients.size === ingredients.length;

  function toggleIngredient(ingredientId: string) {
    setCheckedIngredients((current) => {
      const next = new Set(current);
      if (next.has(ingredientId)) next.delete(ingredientId);
      else next.add(ingredientId);
      return next;
    });
  }

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
      <main className="cooking-content cooking-checklist">
        <div className="cooking-progress-label">
          <span>{checkedIngredients.size} von {ingredients.length} Zutaten bereit</span>
          <label>
            Portionen
            <select value={servings} onChange={(event) => setServings(Number(event.target.value))}>
              {[1, 2, 3, 4, 5, 6, 8, 10, 12].map((count) => <option key={count} value={count}>{count}</option>)}
            </select>
          </label>
        </div>
        <p className="eyebrow"><CookingPot size={15} /> Alles im Blick</p>
        <h1>{recipe.title}</h1>
        <p className="cooking-instruction">Stelle die Zutaten bereit und hake sie ab, sobald sie bereitstehen.</p>
        <section className="cooking-ingredients" aria-label="Zutatenliste">
          <h2>Zutaten</h2>
          <ul className="ingredient-list">
            {ingredients.map((ingredient) => (
              <li key={ingredient.id} className={checkedIngredients.has(ingredient.id) ? "cooking-ingredient checked" : "cooking-ingredient"}>
                <label>
                  <input
                    type="checkbox"
                    checked={checkedIngredients.has(ingredient.id)}
                    onChange={() => toggleIngredient(ingredient.id)}
                  />
                  <span>{ingredient.name}</span>
                  <strong>{formatQuantity(ingredient.quantity, ingredient.unit, servings)}</strong>
                </label>
              </li>
            ))}
          </ul>
        </section>
        {preparation && (
          <section className="cooking-ingredients cooking-preparation" aria-label="Zubereitung">
            <h2>Zubereitung</h2>
            <p>{preparation}</p>
          </section>
        )}
        <div className="cooking-navigation">
          <button className="button button-primary" onClick={onClose}>
            {allChecked ? "Fertig — Guten Appetit" : "Kochmodus schließen"} <Check size={17} />
          </button>
        </div>
      </main>
    </div>
  );
}
