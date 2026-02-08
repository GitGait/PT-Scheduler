/**
 * Image processing utilities for OCR screenshots.
 *
 * Uses browser-image-compression to reduce file size before upload.
 * This prevents hitting Vercel payload limits and reduces API costs.
 */

import imageCompression from "browser-image-compression";

/** Maximum image size in bytes (2MB compressed) */
export const MAX_IMAGE_SIZE_BYTES = 2 * 1024 * 1024;

/** Maximum dimension in pixels */
export const MAX_IMAGE_DIMENSION = 2048;

/** Compression options for OCR screenshots */
const COMPRESSION_OPTIONS = {
  maxSizeMB: 2,
  maxWidthOrHeight: MAX_IMAGE_DIMENSION,
  useWebWorker: true,
  fileType: "image/jpeg" as const
};

/**
 * Compress an image file for OCR upload.
 * Returns a compressed blob that's suitable for base64 encoding and upload.
 */
export async function compressImageForOCR(file: File): Promise<Blob> {
  // Skip compression for small files
  if (file.size <= MAX_IMAGE_SIZE_BYTES) {
    return file;
  }

  return imageCompression(file, COMPRESSION_OPTIONS);
}

/**
 * Convert a Blob to base64 data URL.
 */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("Failed to convert blob to base64"));
      }
    };
    reader.onerror = () => reject(new Error("Failed to read blob"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Prepare an image file for OCR: compress and convert to base64.
 * This is the main function to use before calling the OCR API.
 */
export async function prepareImageForOCR(file: File): Promise<string> {
  const compressed = await compressImageForOCR(file);
  return blobToBase64(compressed);
}

/**
 * Validate that a base64 image string is within size limits.
 * Throws an error if the image is too large.
 */
export function validateImageSize(base64: string): void {
  // Base64 adds ~33% overhead, so check the encoded size
  const sizeBytes = Math.ceil((base64.length * 3) / 4);

  // Allow up to 4MB for Vercel payload limit (with some buffer)
  const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;

  if (sizeBytes > MAX_PAYLOAD_BYTES) {
    throw new Error(
      `Image too large (${Math.round(sizeBytes / 1024 / 1024)}MB). ` +
        `Maximum size is ${Math.round(MAX_PAYLOAD_BYTES / 1024 / 1024)}MB. ` +
        `Try a smaller screenshot or crop the image.`
    );
  }
}
