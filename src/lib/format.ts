export function formatQuantity(quantity: number | null, unit: string, servings = 4): string {
  if (quantity === null) return "nach Bedarf";
  const scaled = quantity * (servings / 4);
  const amount = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(scaled);
  return `${amount}${unit ? ` ${unit}` : ""}`;
}

export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatDateKey(dateKey: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("de-DE", options).format(new Date(`${dateKey}T12:00:00`));
}

export function mondayOf(date: Date): string {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const offset = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - offset);
  return localDateKey(monday);
}

export function addDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}
