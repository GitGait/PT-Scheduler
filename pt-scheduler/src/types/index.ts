// =============================================================================
// Re-export API response types from validation.ts (single source of truth)
// =============================================================================

export type {
  ExtractedAppointment,
  OCRResponse,
  OptimizeStop,
  OptimizeResponse,
  GeocodeResponse,
  AIMatchResponse,
  AlternateContact,
  ExtractPatientResponse,
  DistanceMatrixElement,
  DistanceMatrixResponse
} from "../utils/validation";

// =============================================================================
// Domain Types (Patient, Appointment, etc.)
// =============================================================================

export type PatientStatus = "active" | "discharged" | "evaluation" | "for-other-pt";

export interface Patient {
  id: string;
  fullName: string;
  nicknames: string[];
  phone: string;
  alternateContacts: import("../utils/validation").AlternateContact[];
  address: string;
  lat?: number;
  lng?: number;
  email?: string;
  status: PatientStatus;
  frequencyPerWeek?: number;
  insuranceInfo?: string;
  referralSource?: string;
  notes: string;
  chipNote?: string;
  sheetsRowIndex?: number;
  forOtherPtAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type AppointmentStatus = "scheduled" | "completed" | "cancelled" | "no-show" | "on-hold";
export type SyncStatus = "local" | "pending" | "synced" | "error";

// Single source of truth for visit type codes
export const VISIT_TYPE_CODES = ["PT00", "PT01", "PT02", "PT05", "PT06", "PT10", "PT11", "PT15", "PT18", "PT19", "PT33", "NOMNC"] as const;
export type VisitTypeCode = typeof VISIT_TYPE_CODES[number];
export type VisitType = VisitTypeCode | null;

export interface Appointment {
  id: string;
  patientId: string;
  date: string;
  startTime: string;
  duration: number;
  status: AppointmentStatus;
  syncStatus: SyncStatus;
  calendarEventId?: string;
  notes?: string;
  visitType: VisitType;  // Required field, null means unspecified
  personalCategory?: string;  // For personal events (patientId === "__personal__")
  title?: string;             // Free-text title for personal events
  chipNote?: string;           // Short note displayed as banner on the chip
  createdAt: Date;
  updatedAt: Date;
}

export interface RecurringBlock {
  id: string;
  patientId: string;
  dayOfWeek: number;
  startTime: string;
  duration: number;
  effectiveFrom: string;
  effectiveUntil?: string;
}

export interface CalendarEvent {
  id: string;
  appointmentId: string;
  googleEventId: string;
  calendarId: string;
  lastSyncedAt: Date;
}

// =============================================================================
// Sync Queue Types
// =============================================================================

export type SyncAction = "create" | "update" | "delete";
export type SyncEntity = "appointment" | "calendarEvent" | "patient";
export type SyncQueueStatus =
  | "pending"
  | "processing"
  | "failed"
  | "conflict"
  | "synced";

export interface SyncQueueItem {
  id?: number;
  type: SyncAction;
  entity: SyncEntity;
  data: Record<string, unknown>;
  timestamp: Date;
  retryCount: number;
  status: SyncQueueStatus;
  lastError?: string;
  nextRetryAt?: Date;
  idempotencyKey?: string;
}
