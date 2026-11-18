import { describe, expect, it } from "vitest";
import { isProductBarcodeFormat, StableBarcodeReader } from "./barcode-scan";

describe("barcode scanning", () => {
  it("only accepts linear product barcode formats", () => {
    expect(isProductBarcodeFormat("ean_13")).toBe(true);
    expect(isProductBarcodeFormat("code_39")).toBe(true);
    expect(isProductBarcodeFormat("qr_code")).toBe(false);
  });

  it("requires three matching reads and resets after a missed or different read", () => {
    const reader = new StableBarcodeReader();
    expect(reader.observe("4006381333931")).toBeNull();
    expect(reader.observe("4006381333931")).toBeNull();
    expect(reader.observe("4006381333931")).toBe("4006381333931");
    reader.reset();
    expect(reader.observe("4006381333931")).toBeNull();
    expect(reader.observe(null)).toBeNull();
    expect(reader.observe("4006381333931")).toBeNull();
    expect(reader.observe("4006381333932")).toBeNull();
  });
});
