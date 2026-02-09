import { z } from "zod";

// =============================================================================
// API Response Schemas (Single source of truth - types derived via z.infer)
// =============================================================================

export const extractedAppointmentSchema = z.object({
  rawName: z.string().min(1),
  visitType: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD format"),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Must be HH:mm format"),
  duration: z.number().int().min(15).max(240),
  uncertain: z.boolean().optional()
});

export const ocrResponseSchema = z.object({
  appointments: z.array(extractedAppointmentSchema)
});

export const optimizeStopSchema = z.object({
  locationId: z.string(),
  order: z.number().int().positive(),
  driveTimeMinutes: z.number().int().nonnegative(),
  distanceMiles: z.number().nonnegative()
});

export const optimizeResponseSchema = z.object({
  optimizedOrder: z.array(optimizeStopSchema),
  totalDriveMinutes: z.number().int().nonnegative(),
  totalMiles: z.number().nonnegative()
});

export const geocodeResponseSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  formattedAddress: z.string().optional()
});

export const aiMatchResponseSchema = z.object({
  matchedName: z.string().nullable(),
  confidence: z.number().min(0).max(100)
});

export const alternateContactSchema = z.object({
  firstName: z.string(),
  phone: z.string(),
  relationship: z.string().optional()
});

export const extractPatientResponseSchema = z.object({
  fullName: z.string().default(""),
  phone: z.string().default(""),
  alternateContacts: z.array(alternateContactSchema).default([]),
  address: z.string().default(""),
  email: z.string().default(""),
  notes: z.string().default("")
});

export const csvColumnMappingSchema = z.object({
  id: z.string().nullable(),
  fullName: z.string().nullable(),
  nicknames: z.string().nullable(),
  phone: z.string().nullable(),
  alternateContacts: z.string().nullable(),
  address: z.string().nullable(),
  lat: z.string().nullable(),
  lng: z.string().nullable(),
  status: z.string().nullable(),
  notes: z.string().nullable(),
  email: z.string().nullable()
});

export const csvMappingResponseSchema = z.object({
  mapping: csvColumnMappingSchema,
  confidence: z.record(z.string(), z.number().min(0).max(1)).optional()
});

// =============================================================================
// Inferred Types (derived from schemas - never define these separately!)
// =============================================================================

export type ExtractedAppointment = z.infer<typeof extractedAppointmentSchema>;
export type OCRResponse = z.infer<typeof ocrResponseSchema>;
export type OptimizeStop = z.infer<typeof optimizeStopSchema>;
export type OptimizeResponse = z.infer<typeof optimizeResponseSchema>;
export type GeocodeResponse = z.infer<typeof geocodeResponseSchema>;
export type AIMatchResponse = z.infer<typeof aiMatchResponseSchema>;
export type AlternateContact = z.infer<typeof alternateContactSchema>;
export type ExtractPatientResponse = z.infer<typeof extractPatientResponseSchema>;
export type CSVColumnMapping = z.infer<typeof csvColumnMappingSchema>;
export type CSVMappingResponse = z.infer<typeof csvMappingResponseSchema>;

// =============================================================================
// Request Validation Schemas (for serverless endpoints)
// =============================================================================

/** Maximum image size: 4MB base64 encoded (~3MB raw) */
const MAX_IMAGE_BASE64_LENGTH = 4 * 1024 * 1024 * 1.34; // ~5.36M chars

export const ocrRequestSchema = z.object({
  image: z
    .string()
    .min(100, "Image data is too short to be valid")
    .max(MAX_IMAGE_BASE64_LENGTH, "Image exceeds maximum size of 4MB")
    .refine(
      (val) => val.startsWith("data:image/"),
      "Image must be a valid data URL"
    )
});

export const optimizeRequestSchema = z.object({
  locations: z.array(
    z.object({
      id: z.string(),
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180)
    })
  ).min(1, "At least one location is required"),
  startLocation: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180)
  })
});

export const geocodeRequestSchema = z.object({
  address: z.string().min(5, "Address is too short")
});

export const matchPatientRequestSchema = z.object({
  ocrName: z.string().min(1, "Name is required"),
  candidateNames: z.array(z.string()).min(1, "At least one candidate is required")
});

export const extractPatientRequestSchema = z.object({
  referralText: z.string().min(10, "Referral text is too short")
});

export const csvMappingRequestSchema = z.object({
  headers: z.array(z.string().min(1)).min(1, "At least one CSV header is required"),
  sampleRows: z.array(z.array(z.string())).max(25).default([])
});

// Request types
export type OCRRequest = z.infer<typeof ocrRequestSchema>;
export type OptimizeRequest = z.infer<typeof optimizeRequestSchema>;
export type GeocodeRequest = z.infer<typeof geocodeRequestSchema>;
export type MatchPatientRequest = z.infer<typeof matchPatientRequestSchema>;
export type ExtractPatientRequest = z.infer<typeof extractPatientRequestSchema>;
export type CSVMappingRequest = z.infer<typeof csvMappingRequestSchema>;

// =============================================================================
// Parsing Helper
// =============================================================================

export function parseWithSchema<T>(
  schema: z.ZodType<T>,
  data: unknown,
  context: string
): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; ");
    throw new Error(`${context} validation failed: ${details}`);
  }
  return result.data;
}
