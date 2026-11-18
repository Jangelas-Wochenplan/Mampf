import type { PantryItem, ShoppingItem } from "../types";

interface UnitMeasure {
  dimension: string;
  factor: number;
}

export interface PantryAvailability {
  hasNameMatch: boolean;
  hasCompatibleUnit: boolean;
  availableQuantity: number | null;
  amountToBuy: number | null;
  fullyAvailable: boolean;
}

const metricUnits: Record<string, UnitMeasure> = {
  g: { dimension: "mass", factor: 1 },
  kg: { dimension: "mass", factor: 1000 },
  ml: { dimension: "volume", factor: 1 },
  l: { dimension: "volume", factor: 1000 },
};

function normalizedName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("de-DE")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizedUnit(unit: string): string {
  const clean = unit.trim().toLocaleLowerCase("de-DE");
  if (clean === "gramm") return "g";
  if (clean === "kilogramm") return "kg";
  if (clean === "milliliter") return "ml";
  if (clean === "liter") return "l";
  return clean;
}

function unitMeasure(unit: string): UnitMeasure {
  const normalized = normalizedUnit(unit);
  return metricUnits[normalized] ?? { dimension: `unit:${normalized}`, factor: 1 };
}

function roundedQuantity(quantity: number): number {
  return Math.round((quantity + Number.EPSILON) * 1000) / 1000;
}

export function comparePantryAvailability(
  shoppingItem: Pick<ShoppingItem, "name" | "quantity" | "unit">,
  pantryItems: PantryItem[],
): PantryAvailability {
  const matchingItems = pantryItems.filter(
    (item) => normalizedName(item.name) === normalizedName(shoppingItem.name),
  );
  if (matchingItems.length === 0) {
    return {
      hasNameMatch: false,
      hasCompatibleUnit: false,
      availableQuantity: 0,
      amountToBuy: shoppingItem.quantity,
      fullyAvailable: false,
    };
  }

  const targetUnit = unitMeasure(shoppingItem.unit);
  const compatibleItems = matchingItems.filter(
    (item) => unitMeasure(item.unit).dimension === targetUnit.dimension,
  );
  if (compatibleItems.length === 0) {
    return {
      hasNameMatch: true,
      hasCompatibleUnit: false,
      availableQuantity: null,
      amountToBuy: shoppingItem.quantity,
      fullyAvailable: false,
    };
  }

  const availableInBaseUnits = compatibleItems.reduce(
    (total, item) => total + item.quantity * unitMeasure(item.unit).factor,
    0,
  );
  const availableQuantity = roundedQuantity(availableInBaseUnits / targetUnit.factor);
  const amountToBuy = shoppingItem.quantity === null
    ? null
    : roundedQuantity(Math.max(0, shoppingItem.quantity - availableQuantity));

  return {
    hasNameMatch: true,
    hasCompatibleUnit: true,
    availableQuantity,
    amountToBuy,
    fullyAvailable: amountToBuy === 0,
  };
}
