export const ingredientUnitGroups = [
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
] as const;

export const commonIngredientUnits = new Set<string>(
  ingredientUnitGroups.flatMap((group) => group.units.map((unit) => unit.value)),
);
