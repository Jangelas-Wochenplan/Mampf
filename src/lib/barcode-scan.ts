const PRODUCT_BARCODE_FORMATS = new Set([
  "ean_13",
  "ean_8",
  "upc_a",
  "upc_e",
  "itf",
  "code_128",
  "code_39",
  "code_93",
  "codabar",
]);

export function isProductBarcodeFormat(format: string): boolean {
  return PRODUCT_BARCODE_FORMATS.has(format);
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
