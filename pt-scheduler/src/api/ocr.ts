import { OCRResponse } from "../types";
import { fetchJsonWithTimeout } from "./request";
import { ocrResponseSchema, parseWithSchema } from "../utils/validation";
import { prepareImageForOCR, validateImageSize } from "../utils/image";

/**
 * Process a screenshot image through OCR to extract appointments.
 * Accepts a base64 string (already encoded) or will compress if needed.
 */
export async function processScreenshot(imageBase64: string): Promise<OCRResponse> {
  // Validate size before sending
  validateImageSize(imageBase64);

  const payload = await fetchJsonWithTimeout<unknown>(
    "/api/ocr",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: imageBase64 })
    },
    "OCR failed",
    60_000 // OCR with large images can take longer than the default 30s
  );

  return parseWithSchema(ocrResponseSchema, payload, "processScreenshot");
}

/**
 * Process a screenshot file through OCR.
 * Handles compression and base64 encoding automatically.
 */
export async function processScreenshotFile(file: File): Promise<OCRResponse> {
  const base64 = await prepareImageForOCR(file);
  return processScreenshot(base64);
}

