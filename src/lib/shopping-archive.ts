import type { ShoppingItem } from "../types";

export function isShoppingListComplete(items: Pick<ShoppingItem, "checked">[]): boolean {
  return items.length > 0 && items.every((item) => item.checked);
}
