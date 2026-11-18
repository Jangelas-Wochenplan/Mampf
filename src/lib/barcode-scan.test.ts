import { describe, expect, it } from "vitest";
import {
  hasValidGtinCheckDigit,
  isProductBarcodeFormat,
  isValidProductBarcode,
  StableBarcodeReader,
} from "./barcode-scan";

describe("barcode scanning", () => {
  it("only accepts linear product barcode formats", () => {
    expect(isProductBarcodeFormat("ean_13")).toBe(true);
    expect(isProductBarcodeFormat("qr_code")).toBe(false);
  });

  it("checks common GTIN check digits", () => {
    expect(hasValidGtinCheckDigit("4006381333931")).toBe(true);
    expect(hasValidGtinCheckDigit("4006381333932")).toBe(false);
    expect(hasValidGtinCheckDigit("036000291452")).toBe(true);
    expect(isValidProductBarcode("4006381333931", "ean_13")).toBe(true);
    expect(isValidProductBarcode("4006381333932", "ean_13")).toBe(false);
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
