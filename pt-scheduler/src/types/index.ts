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
  PhoneEntry,
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
  phoneNumbers: import("../utils/validation").PhoneEntry[];
  alternateContacts: import("../utils/validation").AlternateContact[];
  address: string;
  facilityName?: string;
  lat?: number;
  lng?: number;
  email?: string;
  status: PatientStatus;
  frequencyPerWeek?: number;
  insuranceInfo?: string;
  referralSource?: string;
  notes: string;
  chipNote?: string;
  chipNotes?: string[];
  chipNoteColor?: string;
  sheetsRowIndex?: number;
  forOtherPtAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type AppointmentStatus = "scheduled" | "completed" | "cancelled" | "no-show" | "on-hold";
export type SyncStatus = "local" | "pending" | "synced" | "error";

// The 12 visit type codes compiled into the app. Users can rename, recolor and
// hide these, but never remove them: PT18/PT19 drive auto-discharge and NOMNC
// drives scan routing, so the codes are behavioural contracts.
export const BUILT_IN_VISIT_TYPE_CODES = ["PT00", "PT01", "PT02", "PT05", "PT06", "PT10", "PT11", "PT15", "PT18", "PT19", "PT33", "NOMNC"] as const;
export type BuiltInVisitTypeCode = typeof BUILT_IN_VISIT_TYPE_CODES[number];

// Users can define their own codes, so this is an open string. Shape is
// validated by isPlausibleVisitTypeCode in utils/visitTypeCodes.ts.
export type VisitType = string | null;

/** A user-configurable visit type. Built-ins live in code; Dexie holds only overrides and custom types. */
export interface VisitTypeDef {
  code: string;        // PRIMARY KEY, immutable, /^[A-Z][A-Z0-9]{1,9}$/
  label: string;
  bg: string;          // "#rrggbb"
  hidden: boolean;     // hidden from the dropdown only; still colors existing chips
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

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
  address?: string;           // Optional address for personal events (distance calculation)
  recurringGroupId?: string;  // Links recurring personal event occurrences together
  chipNote?: string;           // Short note displayed as banner on the chip
  chipNotes?: string[];        // Multiple stacked chip notes (replaces chipNote)
  chipNoteColor?: string;      // Color for chip note banners
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
// Day Notes (Sticky Notes)
// =============================================================================

export type DayNoteColor = "yellow" | "blue" | "green" | "pink" | "purple" | "orange";

export interface DayNote {
  id: string;            // UUID v4
  date: string;          // YYYY-MM-DD
  text: string;          // free-text content
  color: DayNoteColor;   // default "yellow"
  startMinutes?: number; // grid position (minutes from midnight), default 720 (noon)
  createdAt: Date;
  updatedAt: Date;
}

// =============================================================================
// Sync Queue Types
// =============================================================================

export type SyncAction = "create" | "update" | "delete";
export type SyncEntity = "appointment" | "calendarEvent" | "patient" | "dayNote" | "visitType";
export type SyncQueueStatus =
  | "pending"
  | "processing"
  | "failed"
  | "conflict"
  | "synced";

export interface SyncQueueDataAppointment {
  entityId: string;
  calendarEventId?: string;
}

export interface SyncQueueDataPatient {
  entityId: string;
}

export interface SyncQueueDataCalendarEvent {
  entityId: string;
  calendarEventId?: string;
}

export interface SyncQueueDataDayNote {
  entityId: string;
}

/** `entityId` is the visit type `code` — the table's primary key. */
export interface SyncQueueDataVisitType {
  entityId: string;
}

export type SyncQueueData =
  | SyncQueueDataAppointment
  | SyncQueueDataPatient
  | SyncQueueDataCalendarEvent
  | SyncQueueDataDayNote
  | SyncQueueDataVisitType;

interface SyncQueueItemBase {
  id?: number;
  type: SyncAction;
  timestamp: Date;
  retryCount: number;
  status: SyncQueueStatus;
  lastError?: string;
  nextRetryAt?: Date;
  idempotencyKey?: string;
}

export type SyncQueueItem = SyncQueueItemBase & (
  | { entity: "appointment"; data: SyncQueueDataAppointment }
  | { entity: "patient"; data: SyncQueueDataPatient }
  | { entity: "calendarEvent"; data: SyncQueueDataCalendarEvent }
  | { entity: "dayNote"; data: SyncQueueDataDayNote }
  | { entity: "visitType"; data: SyncQueueDataVisitType }
);
