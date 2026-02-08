# Phase 1: Types and Database

> Goal: define core TypeScript models and IndexedDB schema using Dexie.

## Prerequisites

- Phase 0 complete

## Core Types (`src/types/index.ts`)

### Patient

```ts
export type PatientStatus = "active" | "discharged" | "evaluation";

export interface AlternateContact {
  firstName: string;
  phone: string;
  relationship?: string;
}

export interface Patient {
  id: string;                       // UUID
  fullName: string;                 // "Last, First" format
  nicknames: string[];              // e.g. ["Bob"] for Robert
  phone: string;
  alternateContacts: AlternateContact[];
  address: string;                  // full street address for geocoding
  lat?: number;                     // cached geocode
  lng?: number;
  email?: string;
  status: PatientStatus;
  frequencyPerWeek?: number;        // e.g. 2 = twice/week
  insuranceInfo?: string;
  referralSource?: string;
  notes: string;
  sheetsRowIndex?: number;          // row in Google Sheets for upsert
  createdAt: Date;
  updatedAt: Date;
}
```

### Appointment

```ts
export type AppointmentStatus = "scheduled" | "completed" | "cancelled" | "no-show";
export type SyncStatus = "local" | "pending" | "synced" | "error";

export interface Appointment {
  id: string;                       // UUID
  patientId: string;                // FK → Patient.id
  date: string;                     // ISO date "YYYY-MM-DD"
  startTime: string;                // "HH:mm" 24h
  duration: number;                 // minutes (15-240)
  status: AppointmentStatus;
  syncStatus: SyncStatus;
  calendarEventId?: string;         // Google Calendar event ID once synced
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

### RecurringBlock

```ts
export interface RecurringBlock {
  id: string;
  patientId: string;
  dayOfWeek: number;                // 0=Sun, 1=Mon, ... 6=Sat
  startTime: string;                // "HH:mm"
  duration: number;                 // minutes
  effectiveFrom: string;            // ISO date
  effectiveUntil?: string;          // ISO date, undefined = ongoing
}
```

### CalendarEvent

```ts
export interface CalendarEvent {
  id: string;
  appointmentId: string;
  googleEventId: string;
  calendarId: string;
  lastSyncedAt: Date;
}
```

### SyncQueueItem

```ts
export type SyncAction = "create" | "update" | "delete";
export type SyncEntity = "appointment" | "calendarEvent" | "patient";
export type SyncQueueStatus = "pending" | "processing" | "failed" | "conflict" | "synced";

export interface SyncQueueItem {
  id?: number;                      // auto-incremented by Dexie
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
```

### API Response Types

```ts
export interface ExtractedAppointment {
  rawName: string;
  date: string;
  time: string;
  duration: number;
  uncertain?: boolean;
}

export interface OCRResponse {
  appointments: ExtractedAppointment[];
}

export interface OptimizeResponse {
  optimizedOrder: {
    locationId: string;
    order: number;
    driveTimeMinutes: number;
    distanceMiles: number;
  }[];
  totalDriveMinutes: number;
  totalMiles: number;
}

export interface GeocodeResponse {
  lat: number;
  lng: number;
  formattedAddress?: string;
}

export interface AIMatchResponse {
  matchedName: string | null;
  confidence: number;
}

export interface ExtractPatientResponse {
  fullName: string;
  phone: string;
  alternateContacts: AlternateContact[];
  address: string;
  email: string;
  notes: string;
}
```

## Dexie Schema (`src/db/schema.ts`)

Create `PTSchedulerDB` with stores:
- `patients`
- `appointments`
- `syncQueue`
- `routeCache`
- `recurringBlocks`
- `calendarEvents`

Include key indexes:
- `patients: id, fullName, status`
- `appointments: id, patientId, date, status, syncStatus`
- `syncQueue: ++id, timestamp, status, nextRetryAt`

## DB Operations (`src/db/operations.ts`)

Implement:
- `patientDB`: get/search/add/upsert/discharge/reactivate
- `appointmentDB`: create/update/delete/byDate/byRange/markSynced
- `syncQueueDB`: add/getPending/markProcessing/markFailed/remove/getPendingCount

`markFailed` should increment `retryCount` and set `lastError` + `nextRetryAt`.

## Verification

- Seed script can add sample patients/appointments.
- Queries by date and name work.
- Sync queue items persist with retry metadata.

## Next Phase

-> **[Phase_2_State_Management.md](./Phase_2_State_Management.md)**
