/**
 * Shared scheduling utilities for time, distance, and visit type handling.
 */

// Home Base Configuration
// Note: Home base should be configured via Settings page and stored in localStorage.
// The environment variables provide fallback defaults.
const HOME_BASE_STORAGE_KEY = "ptScheduler.homeBase";

interface HomeBaseConfig {
    address: string;
    lat: number;
    lng: number;
}

const DEFAULT_HOME_BASE: HomeBaseConfig = {
    address: import.meta.env.VITE_HOME_BASE_ADDRESS || "",
    lat: parseFloat(import.meta.env.VITE_HOME_BASE_LAT) || 0,
    lng: parseFloat(import.meta.env.VITE_HOME_BASE_LNG) || 0,
};

/**
 * Get the configured home base address and coordinates.
 * Loads from localStorage, falls back to environment variables.
 */
export function getHomeBase(): HomeBaseConfig {
    if (typeof window === "undefined") {
        return DEFAULT_HOME_BASE;
    }

    try {
        const raw = window.localStorage.getItem(HOME_BASE_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as Partial<HomeBaseConfig>;
            if (parsed.address && typeof parsed.lat === "number" && typeof parsed.lng === "number") {
                return {
                    address: parsed.address,
                    lat: parsed.lat,
                    lng: parsed.lng,
                };
            }
        }
    } catch {
        // Ignore parse errors
    }

    return DEFAULT_HOME_BASE;
}

/**
 * Save home base configuration to localStorage.
 */
export function setHomeBase(config: HomeBaseConfig): void {
    if (typeof window === "undefined") {
        return;
    }

    window.localStorage.setItem(HOME_BASE_STORAGE_KEY, JSON.stringify(config));
}

/**
 * Check if home base is configured.
 */
export function isHomeBaseConfigured(): boolean {
    const config = getHomeBase();
    return Boolean(config.address && config.lat !== 0 && config.lng !== 0);
}

// Constants
export const SLOT_MINUTES = 15;
export const SCHEDULE_START_HOUR = 7;
export const SCHEDULE_START_MINUTE = 30;
export const DAY_START_MINUTES = SCHEDULE_START_HOUR * 60 + SCHEDULE_START_MINUTE; // 7:30 AM
export const OPTIMIZE_START_HOUR = 9;
export const OPTIMIZE_START_MINUTES = OPTIMIZE_START_HOUR * 60; // 9:00 AM - default start time for optimized routes
export const DAY_END_MINUTES = 20 * 60; // 8:00 PM
export const SLOT_HEIGHT_PX = 48;
export const MIN_DURATION_MINUTES = 15;
export const EARTH_RADIUS_MILES = 3958.8;
export const AVERAGE_DRIVE_SPEED_MPH = 30;

/**
 * Convert degrees to radians.
 */
export function toRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
}

/**
 * Calculate distance in miles between two coordinate points using Haversine formula.
 */
export function calculateMilesBetweenCoordinates(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number }
): number {
    const deltaLat = toRadians(to.lat - from.lat);
    const deltaLng = toRadians(to.lng - from.lng);
    const fromLat = toRadians(from.lat);
    const toLat = toRadians(to.lat);

    const a =
        Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
        Math.cos(fromLat) * Math.cos(toLat) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS_MILES * c;
}

/**
 * Estimate drive time in minutes given distance in miles.
 */
export function estimateDriveMinutes(miles: number): number {
    if (miles <= 0) {
        return 0;
    }
    return Math.max(1, Math.round((miles / AVERAGE_DRIVE_SPEED_MPH) * 60));
}

/**
 * Convert time string (HH:MM) to minutes since midnight.
 */
export function timeStringToMinutes(time: string): number {
    const [hoursPart, minutesPart] = time.split(":");
    const hours = Number(hoursPart);
    const minutes = Number(minutesPart);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
        return 0;
    }
    return hours * 60 + minutes;
}

/**
 * Convert minutes since midnight to time string (HH:MM).
 */
export function minutesToTimeString(totalMinutes: number): string {
    const bounded = Math.max(0, Math.min(23 * 60 + 59, totalMinutes));
    const hours = Math.floor(bounded / 60);
    const minutes = bounded % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

/**
 * Format minutes to 12-hour display format (e.g., "7 AM", "12 PM").
 */
export function formatAxisTime(minutes: number): string {
    const hours24 = Math.floor(minutes / 60);
    const meridiem = hours24 >= 12 ? "PM" : "AM";
    const hours12 = ((hours24 + 11) % 12) + 1;
    return `${hours12} ${meridiem}`;
}

/**
 * Check if a time string is aligned to quarter-hour boundaries.
 */
export function isValidQuarterHour(time: string): boolean {
    const [hoursPart, minutesPart] = time.split(":");
    const hours = Number(hoursPart);
    const minutes = Number(minutesPart);

    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
        return false;
    }

    return minutes % SLOT_MINUTES === 0;
}

/**
 * Normalize visit type strings to a consistent format.
 */
export function normalizeVisitType(value?: string): string | undefined {
    const raw = (value ?? "").trim();
    if (!raw) {
        return undefined;
    }

    const cleaned = raw
        .replace(/^[\[\(\{<]+|[\]\)\}>]+$/g, "")
        .replace(/^visit\s*type\s*[:\-]?\s*/i, "")
        .replace(/[–—]/g, "-")
        .replace(/^[\s:;\-]+|[\s:;\-]+$/g, "")
        .replace(/\s+/g, " ")
        .trim();

    if (!cleaned) {
        return undefined;
    }

    const alphaNumeric = cleaned.match(/^([A-Za-z]{1,6})\s*[-]?\s*(\d{1,3})$/);
    if (alphaNumeric) {
        return `${alphaNumeric[1].toUpperCase()}${alphaNumeric[2]}`;
    }

    const keyword = cleaned.match(/^(EVAL|SOC|DC|ROC|RE[-\s]?EVAL)$/i);
    if (keyword) {
        return keyword[1].toUpperCase().replace(/[-\s]/g, "");
    }

    return cleaned.toUpperCase();
}

/**
 * Parse a local ISO date string (YYYY-MM-DD) into a Date at noon local time.
 * Using noon avoids timezone-related date shifts.
 */
export function parseLocalDate(isoDateStr: string): Date {
    return new Date(`${isoDateStr}T12:00:00`);
}

/**
 * Format a Date to ISO date string (YYYY-MM-DD).
 */
export function toIsoDate(date: Date): string {
    return date.toISOString().split("T")[0];
}

/**
 * Get today's date as ISO string (YYYY-MM-DD).
 */
export function todayIso(): string {
    return toIsoDate(new Date());
}

/**
 * Format a Date to local time string (HH:MM).
 */
export function toLocalTime(date: Date): string {
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${hours}:${minutes}`;
}

/**
 * Format a Date to local ISO date string (YYYY-MM-DD) without timezone conversion.
 */
export function toLocalIsoDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

/**
 * Get array of ISO date strings for the week containing the given date.
 */
export function getWeekDates(selectedDate: string): string[] {
    const start = parseLocalDate(selectedDate);
    start.setDate(start.getDate() - start.getDay());

    return Array.from({ length: 7 }, (_, index) => {
        const day = new Date(start);
        day.setDate(start.getDate() + index);
        return toIsoDate(day);
    });
}

/**
 * Build a tel: href from a phone number.
 */
export function buildPhoneHref(rawPhone?: string): string | null {
    if (!rawPhone) {
        return null;
    }

    const trimmed = rawPhone.trim();
    if (!trimmed) {
        return null;
    }

    const normalized = trimmed.replace(/[^\d+]/g, "");
    return normalized ? `tel:${normalized}` : null;
}

/**
 * Build a Google Maps search URL from an address.
 */
export function buildGoogleMapsHref(rawAddress?: string): string | null {
    if (!rawAddress) {
        return null;
    }

    const trimmed = rawAddress.trim();
    if (!trimmed) {
        return null;
    }

    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(trimmed)}`;
}

/**
 * Build an Apple Maps URL from an address.
 */
export function buildAppleMapsHref(rawAddress?: string): string | null {
    if (!rawAddress) {
        return null;
    }

    const trimmed = rawAddress.trim();
    if (!trimmed) {
        return null;
    }

    return `https://maps.apple.com/?q=${encodeURIComponent(trimmed)}`;
}
