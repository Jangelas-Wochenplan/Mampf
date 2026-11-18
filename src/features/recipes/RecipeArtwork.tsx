import { useState, type ReactNode } from "react";

interface RecipeArtworkProps {
  imageUrl?: string | null;
  emoji: string;
  className: string;
  children?: ReactNode;
}

export default function RecipeArtwork({ imageUrl, emoji, className, children }: RecipeArtworkProps) {
  const [failedUrl, setFailedUrl] = useState("");
  const showImage = Boolean(imageUrl && imageUrl !== failedUrl);

  return (
    <div className={`recipe-artwork ${className}${showImage ? " has-image" : ""}`}>
      <span className="recipe-artwork-emoji">{emoji}</span>
      {children}
      {showImage && (
        <img
          className="recipe-artwork-image"
          src={imageUrl ?? undefined}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(imageUrl ?? "")}
        />
      )}
    </div>
  );
}
