export interface IngredientAmount {
  name: string;
  quantity: number | null;
  unit: string;
}

export interface AggregatedIngredient extends IngredientAmount {
  key: string;
}

type MetricFamily = "mass" | "volume";

const metricUnits: Record<string, { family: MetricFamily; factor: number; base: string }> = {
  g: { family: "mass", factor: 1, base: "g" },
  kg: { family: "mass", factor: 1000, base: "g" },
  ml: { family: "volume", factor: 1, base: "ml" },
  l: { family: "volume", factor: 1000, base: "ml" },
};

function normalizedUnit(unit: string): string {
  const clean = unit.trim().toLocaleLowerCase("de-DE");
  if (clean === "gramm") return "g";
  if (clean === "kilogramm") return "kg";
  if (clean === "liter") return "l";
  if (clean === "milliliter") return "ml";
  return clean;
}

function displayMetric(quantity: number, unit: string): { quantity: number; unit: string } {
  const metric = metricUnits[unit];
  if (!metric) return { quantity, unit };
  const baseQuantity = quantity * metric.factor;
  if (metric.family === "mass" && baseQuantity >= 1000) return { quantity: baseQuantity / 1000, unit: "kg" };
  if (metric.family === "volume" && baseQuantity >= 1000) return { quantity: baseQuantity / 1000, unit: "l" };
  return { quantity: baseQuantity, unit: metric.base };
}

export function aggregateIngredients(items: IngredientAmount[]): AggregatedIngredient[] {
  const grouped = new Map<string, { name: string; quantity: number | null; unit: string; family?: MetricFamily }>();

  for (const item of items) {
    const name = item.name.trim().replace(/\s+/g, " ");
    const unit = normalizedUnit(item.unit);
    const metric = metricUnits[unit];
    const family = metric?.family;
    const groupUnit = metric ? metric.base : unit;
    const normalizedName = name.toLocaleLowerCase("de-DE");
    const key = `${normalizedName}|${family ?? "unit"}|${groupUnit}`;
    const current = grouped.get(key);
    const convertedQuantity = item.quantity === null || !metric ? item.quantity : item.quantity * metric.factor;

    if (!current) {
      grouped.set(key, { name, quantity: convertedQuantity, unit: groupUnit, family });
    } else if (current.quantity === null || convertedQuantity === null) {
      current.quantity = null;
    } else {
      current.quantity += convertedQuantity;
    }
  }

  return Array.from(grouped.entries()).map(([key, item]) => {
    const display = item.quantity === null ? { quantity: null, unit: item.unit } : displayMetric(item.quantity, item.unit);
    return { key, name: item.name, ...display };
  });
}
