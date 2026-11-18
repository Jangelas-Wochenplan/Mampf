const PRODUCT_BARCODE_FORMATS = new Set([
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "itf",
  "code_128",
]);

export function isProductBarcodeFormat(format: string): boolean {
  return PRODUCT_BARCODE_FORMATS.has(format);
}

export function hasValidGtinCheckDigit(value: string): boolean {
  if (!/^\d+$/.test(value) || ![8, 12, 13, 14].includes(value.length)) return false;
  const digits = value.split("").map(Number);
  const checkDigit = digits.pop();
  const weightedSum = digits.reduce((sum, digit, index) => {
    const distanceFromRight = digits.length - 1 - index;
    return sum + digit * (distanceFromRight % 2 === 0 ? 3 : 1);
  }, 0);
  return checkDigit === (10 - weightedSum % 10) % 10;
}

export function isValidProductBarcode(value: string, format: string): boolean {
  if (!isProductBarcodeFormat(format)) return false;
  if (format === "ean_13") return value.length === 13 && hasValidGtinCheckDigit(value);
  if (format === "ean_8") return value.length === 8 && hasValidGtinCheckDigit(value);
  if (format === "upc_a") return value.length === 12 && hasValidGtinCheckDigit(value);
  if (format === "upc_e") return /^\d{8}$/.test(value);
  if (format === "itf") return value.length === 14 && hasValidGtinCheckDigit(value);
  return value.trim().length >= 4 && value.trim().length <= 64;
}

export class StableBarcodeReader {
  private lastValue = "";
  private consecutiveReads = 0;

  constructor(private readonly requiredReads = 3) {}

  observe(value: string | null): string | null {
    const barcode = value?.trim() ?? "";
    if (!barcode) {
      this.reset();
      return null;
    }
    if (barcode === this.lastValue) {
      this.consecutiveReads += 1;
    } else {
      this.lastValue = barcode;
      this.consecutiveReads = 1;
    }
    return this.consecutiveReads >= this.requiredReads ? barcode : null;
  }

  reset(): void {
    this.lastValue = "";
    this.consecutiveReads = 0;
  }
}
