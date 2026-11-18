import { describe, expect, it } from "vitest";
import { pantryErrorMessage } from "./pantry-errors";

describe("pantryErrorMessage", () => {
  it("explains when the pantry schema has not been installed", () => {
    expect(pantryErrorMessage({
      code: "PGRST205",
      message: "Table not found",
    })).toContain("supabase/setup_existing_database.sql");
  });

  it("explains when pantry categories or stock merge migration is missing", () => {
    expect(pantryErrorMessage({
      code: "PGRST202",
      message: "Function not found",
    })).toContain("20261118194100_pantry_categories_and_stock_merge.sql");
  });

  it("explains household permission errors", () => {
    expect(pantryErrorMessage({
      code: "42501",
      message: "Permission denied",
    })).toContain("RLS-Policies");
  });

  it("explains expired Supabase sessions separately from RLS failures", () => {
    expect(pantryErrorMessage({
      code: "PGRST301",
      message: "JWT expired",
    })).toContain("Melde dich ab und wieder an");
  });

  it("explains when the pantry image bucket has not been installed", () => {
    expect(pantryErrorMessage(new Error("Bucket not found"))).toContain("supabase/setup_existing_database.sql");
  });

  it("explains duplicate barcodes", () => {
    expect(pantryErrorMessage({
      code: "23505",
      message: "Duplicate key",
    })).toContain("Barcode");
  });

  it("preserves backend diagnostics for other failures", () => {
    expect(pantryErrorMessage({
      code: "XX000",
      message: "Database unavailable",
      hint: "Try again later",
    })).toBe("Database unavailable (XX000) Try again later");
  });
});
