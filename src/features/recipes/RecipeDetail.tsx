import { useState } from "react";
import { Clock3, CookingPot, ExternalLink, Pencil, Star, X } from "lucide-react";
import RecipeArtwork from "./RecipeArtwork";
import { averageRating, ratingByUser } from "../../lib/ratings";
import type { Recipe } from "../../types";
import { formatQuantity } from "../../lib/format";

interface RecipeDetailProps {
  recipe: Recipe;
  onClose: () => void;
  onEdit: () => void;
  onCook: () => void;
  currentUserId: string;
  busy: boolean;
  onRate: (rating: number) => void;
}

export default function RecipeDetail({
  recipe,
  onClose,
  onEdit,
  onCook,
  currentUserId,
  busy,
  onRate,
}: RecipeDetailProps) {
  const [servings, setServings] = useState(4);
  const ingredients = recipe.recipe_ingredients.slice().sort((a, b) => a.sort_order - b.sort_order);
  const steps = recipe.recipe_steps.slice().sort((a, b) => a.position - b.position);
  const ratings = recipe.recipe_ratings ?? [];
  const average = averageRating(ratings);
  const ownRating = ratingByUser(ratings, currentUserId);

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
          <RecipeArtwork className="recipe-art detail-art" imageUrl={recipe.image_url} emoji={recipe.emoji} />
          <div>
            <p className="eyebrow">Aus eurem Kochbuch</p>
            <h2 id="recipe-detail-title">{recipe.title}</h2>
            <p>{recipe.description || "Ein Lieblingsessen für die ganze Runde."}</p>
            {recipe.category && <span className="category-chip">{recipe.category}</span>}
            {recipe.prep_minutes && <span className="meta-pill"><Clock3 size={15} /> {recipe.prep_minutes} Min.</span>}
            {recipe.source_url && (
              <a className="recipe-source-link" href={recipe.source_url} target="_blank" rel="noreferrer">
                <ExternalLink size={14} /> Originalrezept öffnen
              </a>
            )}
          </div>
        </div>
        <div className="detail-rating">
          <div>
            <strong>Deine Bewertung</strong>
            <div className="rating-stars" role="group" aria-label="Rezept mit Sternen bewerten">
              {[1, 2, 3, 4, 5].map((rating) => (
                <button
                  type="button"
                  key={rating}
                  className={rating <= ownRating ? "rating-star selected" : "rating-star"}
                  aria-label={`${rating} ${rating === 1 ? "Stern" : "Sterne"} vergeben`}
                  aria-pressed={ownRating === rating}
                  disabled={busy}
                  onClick={() => onRate(rating)}
                >
                  <Star size={20} fill={rating <= ownRating ? "currentColor" : "none"} />
                </button>
              ))}
            </div>
          </div>
          <p className="rating-average">
            {average === null
              ? "Noch keine Bewertungen"
              : `Durchschnitt ${average.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} von 5 · ${ratings.length} ${ratings.length === 1 ? "Bewertung" : "Bewertungen"}`}
          </p>
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
