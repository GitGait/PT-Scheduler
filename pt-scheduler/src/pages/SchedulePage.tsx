import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type DragEvent,
    type MouseEvent,
    type TouchEvent,
} from "react";
import { useAppointmentStore, usePatientStore, useScheduleStore, useSyncStore, type ExternalCalendarEvent } from "../stores";
import { fetchCalendarEvents } from "../api/calendar";
import { isSignedIn } from "../api/auth";
import { syncPatientToSheetByStatus } from "../api/sheets";
import { Card, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { ScheduleGridSkeleton } from "../components/ui/Skeleton";
import { ScheduleEmptyState } from "../components/ui/EmptyState";
import { AppointmentDetailModal } from "../components/AppointmentDetailModal";
import { AppointmentActionSheet } from "../components/AppointmentActionSheet";
import { geocodeAddress } from "../api/geocode";
import { getDistanceMatrix } from "../api/distance";
import { db } from "../db/schema";
import type { Appointment, Patient, VisitType } from "../types";
import { getVisitTypeGradient, VISIT_TYPE_CONFIGS } from "../utils/visitTypeColors";
import "leaflet/dist/leaflet.css";
import {
    ChevronLeft,
    ChevronRight,
    ChevronDown,
    Plus,
    X,
    Phone,
    MapPin,
    Navigation,
    Clock,
    Car,
} from "lucide-react";

const SLOT_MINUTES = 15;
const DAY_START_MINUTES = 7 * 60 + 30; // 7:30 AM
const DAY_END_MINUTES = 20 * 60;
const SLOT_HEIGHT_PX = 48;
const MIN_DURATION_MINUTES = 15;
const EARTH_RADIUS_MILES = 3958.8;
const AVERAGE_DRIVE_SPEED_MPH = 30;
import { getHomeBase } from "../utils/scheduling";
const APPOINTMENTS_SYNCED_EVENT = "pt-scheduler:appointments-synced";
const REQUEST_SYNC_EVENT = "pt-scheduler:request-sync";

const triggerSync = () => {
    window.dispatchEvent(new Event(REQUEST_SYNC_EVENT));
};

interface ClearedWeekAppointmentSnapshot {
    patientId: string;
    date: string;
    startTime: string;
    duration: number;
    status: Appointment["status"];
    notes?: string;
}

interface ClearedWeekSnapshot {
    weekStart: string;
    weekEnd: string;
    appointments: ClearedWeekAppointmentSnapshot[];
}

interface DayMapPoint {
    id: string;
    label: string;
    lat: number;
    lng: number;
    isHome: boolean;
}

const toIsoDate = (date: Date): string => date.toISOString().split("T")[0];

const parseIsoDate = (date: string): Date => new Date(`${date}T12:00:00`);

const todayIso = (): string => toIsoDate(new Date());

const getWeekDates = (selectedDate: string): string[] => {
    const start = parseIsoDate(selectedDate);
    // Start week on Monday: getDay() returns 0 for Sun, 1 for Mon, etc.
    // For Mon-Sun we need offset: Sun(0)→-6, Mon(1)→0, Tue(2)→-1, ...
    const dow = start.getDay();
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    start.setDate(start.getDate() + mondayOffset);

    return Array.from({ length: 7 }, (_, index) => {
        const day = new Date(start);
        day.setDate(start.getDate() + index);
        return toIsoDate(day);
    });
};

const minutesToTimeString = (minutes: number): string => {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
};

const timeStringToMinutes = (time: string): number => {
    const [hoursPart, minutesPart] = time.split(":");
    return Number(hoursPart) * 60 + Number(minutesPart);
};

const formatAxisTime = (minutes: number): string => {
    const hours24 = Math.floor(minutes / 60);
    const meridiem = hours24 >= 12 ? "PM" : "AM";
    const hours12 = ((hours24 + 11) % 12) + 1;
    return `${hours12} ${meridiem}`;
};

const isValidQuarterHour = (time: string): boolean => {
    const [hoursPart, minutesPart] = time.split(":");
    const hours = Number(hoursPart);
    const minutes = Number(minutesPart);

    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
        return false;
    }

    return minutes % SLOT_MINUTES === 0;
};

const toRadians = (degrees: number): number => degrees * (Math.PI / 180);

const calculateMilesBetweenCoordinates = (
    from: { lat: number; lng: number },
    to: { lat: number; lng: number }
): number => {
    const deltaLat = toRadians(to.lat - from.lat);
    const deltaLng = toRadians(to.lng - from.lng);
    const fromLat = toRadians(from.lat);
    const toLat = toRadians(to.lat);

    const a =
        Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
        Math.cos(fromLat) * Math.cos(toLat) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS_MILES * c;
};

function orderByFarthestFromHome<T extends { lat: number; lng: number }>(
    items: T[],
    home: { lat: number; lng: number }
): T[] {
    return [...items].sort(
        (a, b) =>
            calculateMilesBetweenCoordinates(home, b) - calculateMilesBetweenCoordinates(home, a)
    );
}

const estimateDriveMinutes = (miles: number): number => {
    if (miles <= 0) {
        return 0;
    }
    return Math.max(1, Math.round((miles / AVERAGE_DRIVE_SPEED_MPH) * 60));
};

const buildPhoneHref = (rawPhone?: string): string | null => {
    if (!rawPhone) {
        return null;
    }

    const trimmed = rawPhone.trim();
    if (!trimmed) {
        return null;
    }

    const normalized = trimmed.replace(/[^\d+]/g, "");
    return normalized ? `tel:${normalized}` : null;
};

const buildGoogleMapsHref = (rawAddress?: string): string | null => {
    if (!rawAddress) {
        return null;
    }

    const trimmed = rawAddress.trim();
    if (!trimmed) {
        return null;
    }

    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(trimmed)}`;
};

const buildAppleMapsHref = (rawAddress?: string): string | null => {
    if (!rawAddress) {
        return null;
    }

    const trimmed = rawAddress.trim();
    if (!trimmed) {
        return null;
    }

    return `https://maps.apple.com/?q=${encodeURIComponent(trimmed)}`;
};

const buildGoogleMapsDirectionsFromCoordinatesHref = (
    home: { lat: number; lng: number },
    stops: Array<{ lat: number; lng: number }>
): string | null => {
    if (stops.length === 0) {
        return `https://www.google.com/maps/search/?api=1&query=${home.lat},${home.lng}`;
    }

    const destination = stops[stops.length - 1];
    const waypoints = stops.slice(0, -1).map((stop) => `${stop.lat},${stop.lng}`);
    const url = new URL("https://www.google.com/maps/dir/");
    url.searchParams.set("api", "1");
    url.searchParams.set("origin", `${home.lat},${home.lng}`);
    url.searchParams.set("destination", `${destination.lat},${destination.lng}`);
    if (waypoints.length > 0) {
        url.searchParams.set("waypoints", waypoints.join("|"));
    }
    url.searchParams.set("travelmode", "driving");
    return url.toString();
};

const isIOS = (): boolean => {
    if (typeof navigator === "undefined") return false;
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
};

export function SchedulePage() {
    const {
        selectedDate,
        setSelectedDate,
        sidebarOpen,
        googleCalendars,
        enabledCalendars,
        externalEvents,
        setExternalEvents,
    } = useScheduleStore();
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [newPatientId, setNewPatientId] = useState("");
    const [newAppointmentDate, setNewAppointmentDate] = useState(todayIso);
    const [newStartTime, setNewStartTime] = useState("09:00");
    const [newDuration, setNewDuration] = useState(60);
    const [newVisitType, setNewVisitType] = useState<VisitType>(null);
    const [addError, setAddError] = useState<string | null>(null);
    const [autoArrangeError, setAutoArrangeError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [autoArrangeInProgressByDay, setAutoArrangeInProgressByDay] = useState<
        Record<string, boolean>
    >({});
    const [draggingAppointmentId, setDraggingAppointmentId] = useState<string | null>(null);
    const [dragPreview, setDragPreview] = useState<{ date: string; startTime: string } | null>(null);
    const [moveAppointmentId, setMoveAppointmentId] = useState<string | null>(null);
    const [copyAppointmentId, setCopyAppointmentId] = useState<string | null>(null);
    const [resizingAppointmentId, setResizingAppointmentId] = useState<string | null>(null);
    const [draftRenderById, setDraftRenderById] = useState<
        Record<string, { startMinutes: number; duration: number }>
    >({});
    const suppressNextSlotClickRef = useRef(false);
    const suppressNextChipClickRef = useRef(false);
    const suppressClickTimerRef = useRef<number | null>(null);
    const suppressChipClickTimerRef = useRef<number | null>(null);
    const slotLongPressTimerRef = useRef<number | null>(null);
    const slotLongPressTargetRef = useRef<{ date: string; startTime: string } | null>(null);
    const resizeLongPressTimerRef = useRef<number | null>(null);
    const resizeLongPressDataRef = useRef<{
        clientY: number;
        appointment: Appointment;
        edge: "top" | "bottom";
    } | null>(null);
    const resizeSessionRef = useRef<{
        appointmentId: string;
        startY: number;
        edge: "top" | "bottom";
        initialStartMinutes: number;
        initialDuration: number;
        initialEndMinutes: number;
    } | null>(null);
    const resizeDraftRef = useRef<{ startMinutes: number; duration: number } | null>(null);

    // Touch-based drag refs for mobile appointment dragging
    const touchDragRef = useRef<{
        appointmentId: string;
        startX: number;
        startY: number;
        activated: boolean;
    } | null>(null);
    const touchDragTimerRef = useRef<number | null>(null);
    const touchDragPreviewRef = useRef<{ date: string; startTime: string } | null>(null);
    const [touchDragGhost, setTouchDragGhost] = useState<{ x: number; y: number; name: string; duration: number } | null>(null);

    const [homeCoordinates, setHomeCoordinates] = useState<{ lat: number; lng: number } | null>(() => {
        const homeBase = getHomeBase();
        return homeBase.lat !== 0 && homeBase.lng !== 0 ? { lat: homeBase.lat, lng: homeBase.lng } : null;
    });
    const [resolvedPatientCoordinates, setResolvedPatientCoordinates] = useState<
        Record<string, { lat: number; lng: number }>
    >({});
    const patientGeocodeInFlightRef = useRef(new Set<string>());
    const [detailAppointmentId, setDetailAppointmentId] = useState<string | null>(null);
    const [mapsMenuAddress, setMapsMenuAddress] = useState<string | null>(null);
    const [actionSheetAppointmentId, setActionSheetAppointmentId] = useState<string | null>(null);

    // Driving distances from Google Distance Matrix API (real road distances)
    const [drivingDistances, setDrivingDistances] = useState<
        Record<string, { miles: number; minutes: number }>
    >({});
    const distanceFetchInFlightRef = useRef<string | null>(null);

    // Zoom state for pinch-to-zoom on mobile
    const [zoomScale, setZoomScale] = useState(1);
    const zoomContainerRef = useRef<HTMLDivElement>(null);
    const pinchStateRef = useRef<{
        initialDistance: number;
        initialScale: number;
    } | null>(null);

    // View mode state (day or week)
    const [viewMode, setViewMode] = useState<'day' | 'week'>('week');
    const [viewDropdownOpen, setViewDropdownOpen] = useState(false);

    // Header scroll shadow state
    const [isScrolled, setIsScrolled] = useState(false);
    const [lastClearedWeekSnapshot, setLastClearedWeekSnapshot] = useState<ClearedWeekSnapshot | null>(null);
    const [weekActionInProgress, setWeekActionInProgress] = useState(false);
    const [weekActionMessage, setWeekActionMessage] = useState<string | null>(null);
    const [weekActionError, setWeekActionError] = useState<string | null>(null);
    const [isDayMapOpen, setIsDayMapOpen] = useState(false);
    const [isDayMapLoading, setIsDayMapLoading] = useState(false);
    const [dayMapError, setDayMapError] = useState<string | null>(null);
    const [dayMapInfoMessage, setDayMapInfoMessage] = useState<string | null>(null);
    const [dayMapPoints, setDayMapPoints] = useState<DayMapPoint[]>([]);
    const dayMapContainerRef = useRef<HTMLDivElement | null>(null);
    const dayMapInstanceRef = useRef<import("leaflet").Map | null>(null);
    const dayMapLayerRef = useRef<import("leaflet").LayerGroup | null>(null);

    const { patients, loadAll, update: updatePatient } = usePatientStore();
    const { appointments, loading, loadByRange, markComplete, create, update, delete: deleteAppointment } =
        useAppointmentStore();

    const weekDates = useMemo(() => getWeekDates(selectedDate), [selectedDate]);
    const weekStart = weekDates[0];
    const weekEnd = weekDates[6];

    // Dates to display based on view mode
    const displayDates = useMemo(() => {
        return viewMode === 'day' ? [selectedDate] : weekDates;
    }, [viewMode, selectedDate, weekDates]);

    const timeSlots = useMemo(() => {
        const slots: number[] = [];
        for (let minutes = DAY_START_MINUTES; minutes < DAY_END_MINUTES; minutes += SLOT_MINUTES) {
            slots.push(minutes);
        }
        return slots;
    }, []);

    useEffect(() => {
        void loadAll();
    }, [loadAll]);

    useEffect(() => {
        if (!weekStart || !weekEnd) return;
        void loadByRange(weekStart, weekEnd);
    }, [loadByRange, weekStart, weekEnd]);

    useEffect(() => {
        const handleAppointmentsSynced = () => {
            if (!weekStart || !weekEnd) {
                return;
            }
            // Preserve scroll position when sync replaces appointments
            const scrollTop = zoomContainerRef.current?.scrollTop ?? 0;
            const scrollLeft = zoomContainerRef.current?.scrollLeft ?? 0;
            pendingScrollRestoreRef.current = { top: scrollTop, left: scrollLeft, rendersLeft: 10 };
            void loadByRange(weekStart, weekEnd);
        };

        window.addEventListener(APPOINTMENTS_SYNCED_EVENT, handleAppointmentsSynced);
        return () => {
            window.removeEventListener(APPOINTMENTS_SYNCED_EVENT, handleAppointmentsSynced);
        };
    }, [loadByRange, weekStart, weekEnd]);

    useEffect(() => {
        let cancelled = false;

        const loadHomeCoordinates = async () => {
            const homeBase = getHomeBase();

            // If we already have valid coordinates from config, use them
            if (homeBase.lat !== 0 && homeBase.lng !== 0) {
                if (!cancelled) {
                    setHomeCoordinates({ lat: homeBase.lat, lng: homeBase.lng });
                }
                return;
            }

            // Otherwise try to geocode the address
            if (!homeBase.address) {
                return;
            }

            try {
                const geocoded = await geocodeAddress(homeBase.address);
                if (!cancelled) {
                    const hasValidCoordinates =
                        Number.isFinite(geocoded.lat) && Number.isFinite(geocoded.lng);
                    if (hasValidCoordinates) {
                        setHomeCoordinates({ lat: geocoded.lat, lng: geocoded.lng });
                    }
                }
            } catch {
                // Keep existing coordinates if geocoding fails
            }
        };

        void loadHomeCoordinates();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (patients.length === 0) {
            setNewPatientId("");
            return;
        }

        const exists = patients.some((patient) => patient.id === newPatientId);
        if (!exists) {
            setNewPatientId(patients[0].id);
        }
    }, [patients, newPatientId]);

    // Close view dropdown when clicking outside
    useEffect(() => {
        if (!viewDropdownOpen) return;

        const handleClickOutside = () => {
            setViewDropdownOpen(false);
        };

        // Delay adding listener to avoid immediate close
        const timer = setTimeout(() => {
            document.addEventListener('click', handleClickOutside);
        }, 0);

        return () => {
            clearTimeout(timer);
            document.removeEventListener('click', handleClickOutside);
        };
    }, [viewDropdownOpen]);

    // Get month/year display
    const monthYearDisplay = parseIsoDate(selectedDate).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
    });

    const navigateWeek = (direction: number) => {
        const date = parseIsoDate(selectedDate);
        // Navigate by day in day view, by week in week view
        const daysToMove = viewMode === 'day' ? direction : direction * 7;
        date.setDate(date.getDate() + daysToMove);
        setSelectedDate(toIsoDate(date));
    };

    const appointmentCountsByDay = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const apt of appointments) {
            counts[apt.date] = (counts[apt.date] ?? 0) + 1;
        }
        return counts;
    }, [appointments]);

    const selectedDayAppointments = useMemo(() => {
        return appointments
            .filter((apt) => apt.date === selectedDate)
            .sort((a, b) => a.startTime.localeCompare(b.startTime));
    }, [appointments, selectedDate]);

    const selectedMoveAppointment = useMemo(
        () => appointments.find((apt) => apt.id === moveAppointmentId),
        [appointments, moveAppointmentId]
    );
    const selectedCopyAppointment = useMemo(
        () => appointments.find((apt) => apt.id === copyAppointmentId),
        [appointments, copyAppointmentId]
    );
    const draggingAppointment = useMemo(
        () => appointments.find((apt) => apt.id === draggingAppointmentId) ?? null,
        [appointments, draggingAppointmentId]
    );
    const patientById = useMemo(() => {
        const map = new Map<string, (typeof patients)[number]>();
        for (const patient of patients) {
            map.set(patient.id, patient);
        }
        return map;
    }, [patients]);

    const appointmentsByDay = useMemo(() => {
        const grouped: Record<string, Appointment[]> = {};
        for (const date of weekDates) {
            grouped[date] = [];
        }

        for (const appointment of appointments) {
            if (grouped[appointment.date]) {
                grouped[appointment.date].push(appointment);
            }
        }

        for (const date of Object.keys(grouped)) {
            grouped[date].sort((a, b) => a.startTime.localeCompare(b.startTime));
        }

        return grouped;
    }, [appointments, weekDates]);

    // Group external events by day
    const externalEventsByDay = useMemo(() => {
        const grouped: Record<string, ExternalCalendarEvent[]> = {};
        for (const date of weekDates) {
            grouped[date] = [];
        }

        for (const event of externalEvents) {
            // Parse the start datetime to get the date
            const eventDate = event.startDateTime.split("T")[0];
            if (grouped[eventDate]) {
                grouped[eventDate].push(event);
            }
        }

        // Sort by start time
        for (const date of Object.keys(grouped)) {
            grouped[date].sort((a, b) => a.startDateTime.localeCompare(b.startDateTime));
        }

        return grouped;
    }, [externalEvents, weekDates]);

    useEffect(() => {
        let cancelled = false;
        const patientsNeedingCoordinates: Patient[] = [];

        for (const appointment of appointments) {
            const patient = patientById.get(appointment.patientId);
            if (!patient?.address?.trim()) {
                continue;
            }
            if (patient.lat !== undefined && patient.lng !== undefined) {
                continue;
            }
            if (resolvedPatientCoordinates[patient.id]) {
                continue;
            }
            if (patientGeocodeInFlightRef.current.has(patient.id)) {
                continue;
            }
            patientsNeedingCoordinates.push(patient);
        }

        if (patientsNeedingCoordinates.length === 0) {
            return;
        }

        const geocodePatients = async () => {
            const updates: Record<string, { lat: number; lng: number }> = {};

            for (const patient of patientsNeedingCoordinates) {
                patientGeocodeInFlightRef.current.add(patient.id);
            }

            try {
                await Promise.all(
                    patientsNeedingCoordinates.map(async (patient) => {
                        try {
                            const geocoded = await geocodeAddress(patient.address);
                            updates[patient.id] = { lat: geocoded.lat, lng: geocoded.lng };
                        } catch {
                            // Skip unresolved addresses
                        }
                    })
                );
            } finally {
                for (const patient of patientsNeedingCoordinates) {
                    patientGeocodeInFlightRef.current.delete(patient.id);
                }
            }

            if (!cancelled && Object.keys(updates).length > 0) {
                setResolvedPatientCoordinates((current) => ({ ...current, ...updates }));
            }
        };

        void geocodePatients();
        return () => {
            cancelled = true;
        };
    }, [appointments, patientById, resolvedPatientCoordinates]);

    // Fetch real driving distances from Google Distance Matrix API
    useEffect(() => {
        let cancelled = false;

        const fetchDrivingDistances = async () => {
            // Build list of locations for each day
            for (const date of Object.keys(appointmentsByDay)) {
                const dayAppointments = appointmentsByDay[date];
                if (dayAppointments.length === 0) continue;

                // Build locations array: optionally home + all appointments with coordinates
                const locations: Array<{ id: string; lat: number; lng: number }> = [];

                if (homeCoordinates) {
                    locations.push({ id: `home-${date}`, lat: homeCoordinates.lat, lng: homeCoordinates.lng });
                }

                for (const apt of dayAppointments) {
                    const patient = patientById.get(apt.patientId);
                    let coords: { lat: number; lng: number } | null = null;

                    if (patient?.lat !== undefined && patient?.lng !== undefined) {
                        coords = { lat: patient.lat, lng: patient.lng };
                    } else if (resolvedPatientCoordinates[apt.patientId]) {
                        coords = resolvedPatientCoordinates[apt.patientId];
                    }

                    if (coords) {
                        locations.push({ id: apt.id, lat: coords.lat, lng: coords.lng });
                    }
                }

                // Need at least 2 locations to calculate distances
                if (locations.length < 2) continue;

                // Create a cache key to avoid redundant fetches
                const cacheKey = locations.map(l => `${l.id}:${l.lat},${l.lng}`).join('|');
                if (distanceFetchInFlightRef.current === cacheKey) continue;

                distanceFetchInFlightRef.current = cacheKey;

                try {
                    const result = await getDistanceMatrix(locations);

                    if (cancelled) return;

                    // Update driving distances state
                    const updates: Record<string, { miles: number; minutes: number }> = {};
                    for (const dist of result.distances) {
                        updates[dist.destinationId] = {
                            miles: dist.distanceMiles,
                            minutes: dist.durationMinutes
                        };
                    }

                    if (Object.keys(updates).length > 0) {
                        setDrivingDistances(prev => ({ ...prev, ...updates }));
                    }
                } catch (err) {
                    console.error('Failed to fetch driving distances:', err);
                } finally {
                    distanceFetchInFlightRef.current = null;
                }
            }
        };

        // Debounce the fetch to avoid rapid re-fetching
        const timeoutId = setTimeout(() => {
            void fetchDrivingDistances();
        }, 500);

        return () => {
            cancelled = true;
            clearTimeout(timeoutId);
        };
    }, [appointmentsByDay, homeCoordinates, patientById, resolvedPatientCoordinates]);

    const getPatientCoordinates = (patientId: string): { lat: number; lng: number } | null => {
        const patient = patientById.get(patientId);
        if (!patient) {
            return null;
        }
        if (patient.lat !== undefined && patient.lng !== undefined) {
            return { lat: patient.lat, lng: patient.lng };
        }
        return resolvedPatientCoordinates[patientId] ?? null;
    };

    const resolvePatientCoordinatesForRouting = useCallback(
        async (patientId: string): Promise<{ lat: number; lng: number } | null> => {
            const existing = getPatientCoordinates(patientId);
            if (existing) {
                return existing;
            }

            const patient = patientById.get(patientId);
            const address = patient?.address?.trim();
            if (!address) {
                return null;
            }

            try {
                const geocoded = await geocodeAddress(address);
                if (!Number.isFinite(geocoded.lat) || !Number.isFinite(geocoded.lng)) {
                    return null;
                }

                const coords = { lat: geocoded.lat, lng: geocoded.lng };
                setResolvedPatientCoordinates((current) => ({
                    ...current,
                    [patientId]: coords,
                }));
                return coords;
            } catch {
                return null;
            }
        },
        [patientById, resolvedPatientCoordinates]
    );

    const legInfoByAppointmentId = useMemo(() => {
        const infoById: Record<
            string,
            { miles: number | null; minutes: number | null; fromHome: boolean; isRealDistance: boolean }
        > = {};

        for (const date of Object.keys(appointmentsByDay)) {
            const dayAppointments = appointmentsByDay[date];
            let previousCoords: { lat: number; lng: number } | null = homeCoordinates;

            for (let index = 0; index < dayAppointments.length; index += 1) {
                const appointment = dayAppointments[index];
                const isFirstOfDay = index === 0;
                const currentCoords = getPatientCoordinates(appointment.patientId);

                // Check if we have real driving distance from the API
                const realDistance = drivingDistances[appointment.id];
                if (realDistance) {
                    infoById[appointment.id] = {
                        miles: realDistance.miles,
                        minutes: realDistance.minutes,
                        fromHome: isFirstOfDay,
                        isRealDistance: true,
                    };
                    if (currentCoords) {
                        previousCoords = currentCoords;
                    }
                    continue;
                }

                // Fall back to straight-line distance
                if (!currentCoords) {
                    infoById[appointment.id] = {
                        miles: null,
                        minutes: null,
                        fromHome: isFirstOfDay,
                        isRealDistance: false,
                    };
                    continue;
                }

                if (!previousCoords) {
                    infoById[appointment.id] = {
                        miles: null,
                        minutes: null,
                        fromHome: isFirstOfDay,
                        isRealDistance: false,
                    };
                    previousCoords = currentCoords;
                    continue;
                }

                const legMiles = calculateMilesBetweenCoordinates(previousCoords, currentCoords);
                const roundedMiles = Math.round(legMiles * 10) / 10;
                infoById[appointment.id] = {
                    miles: roundedMiles,
                    minutes: estimateDriveMinutes(roundedMiles),
                    fromHome: isFirstOfDay,
                    isRealDistance: false,
                };
                previousCoords = currentCoords;
            }
        }

        return infoById;
    }, [appointmentsByDay, homeCoordinates, patientById, resolvedPatientCoordinates, drivingDistances]);

    const selectedDayEstimatedMiles = useMemo(() => {
        return selectedDayAppointments.reduce((total, appointment) => {
            const legMiles = legInfoByAppointmentId[appointment.id]?.miles;
            return total + (legMiles ?? 0);
        }, 0);
    }, [selectedDayAppointments, legInfoByAppointmentId]);

    const selectedDayEstimatedDriveMinutes = useMemo(() => {
        return selectedDayAppointments.reduce((total, appointment) => {
            const driveMinutes = legInfoByAppointmentId[appointment.id]?.minutes;
            return total + (driveMinutes ?? 0);
        }, 0);
    }, [selectedDayAppointments, legInfoByAppointmentId]);

    const getPatient = (patientId: string) => patientById.get(patientId);

    const formatPatientDisplayName = (patient: Patient) => {
        const nickname = patient.nicknames.find((value) => value.trim().length > 0);
        if (!nickname) {
            return patient.fullName;
        }
        return `${patient.fullName} "${nickname.trim()}"`;
    };

    const getPatientName = (patientId: string) => {
        const patient = getPatient(patientId);
        if (!patient) {
            return "Unknown Patient";
        }
        return formatPatientDisplayName(patient);
    };

    const openAddAppointment = (prefillDate = selectedDate, prefillTime?: string) => {
        setSelectedDate(prefillDate);
        setNewAppointmentDate(prefillDate);
        if (prefillTime) {
            setNewStartTime(prefillTime);
        }
        setAddError(null);
        setIsAddOpen(true);
    };

    const cancelAddAppointment = () => {
        setAddError(null);
        setIsAddOpen(false);
    };

    const handleCreateAppointment = async () => {
        if (!newPatientId) {
            setAddError("Please select a patient.");
            return;
        }

        if (!newAppointmentDate) {
            setAddError("Please choose an appointment date.");
            return;
        }

        if (!isValidQuarterHour(newStartTime)) {
            setAddError("Start time must be in 15-minute increments.");
            return;
        }

        if (newDuration < 15 || newDuration > 240 || newDuration % 15 !== 0) {
            setAddError("Duration must be in 15-minute increments between 15 and 240.");
            return;
        }

        setIsSaving(true);
        setAddError(null);

        try {
            await create({
                patientId: newPatientId,
                date: newAppointmentDate,
                startTime: newStartTime,
                duration: newDuration,
                visitType: newVisitType,
                status: "scheduled",
                syncStatus: "local",
                notes: undefined,
            });
            setSelectedDate(newAppointmentDate);
            setIsAddOpen(false);
            setNewStartTime("09:00");
            setNewDuration(60);
            setNewVisitType(null);
            triggerSync();
        } catch (err) {
            setAddError(err instanceof Error ? err.message : "Failed to add appointment.");
        } finally {
            setIsSaving(false);
        }
    };

    const handleAppointmentDragStart = (
        event: DragEvent<HTMLDivElement>,
        appointmentId: string
    ) => {
        // Lock scroll position BEFORE any state changes that trigger re-renders.
        // State updates (draggingAppointmentId, moveAppointmentId, dragPreview)
        // cause re-renders that can reset scroll position in the flex layout.
        const scrollTop = zoomContainerRef.current?.scrollTop ?? 0;
        const scrollLeft = zoomContainerRef.current?.scrollLeft ?? 0;
        pendingScrollRestoreRef.current = { top: scrollTop, left: scrollLeft, rendersLeft: 10 };

        event.dataTransfer.setData("text/plain", appointmentId);
        event.dataTransfer.effectAllowed = "move";
        setDraggingAppointmentId(appointmentId);
        setMoveAppointmentId(appointmentId);
        const existing = appointments.find((apt) => apt.id === appointmentId);
        if (existing) {
            setDragPreview({ date: existing.date, startTime: existing.startTime });
        }
    };

    const handleAppointmentDragEnd = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setDraggingAppointmentId(null);
        setDragPreview(null);
        setMoveAppointmentId(null);
    };

    const updateDragPreview = (date: string, startTime: string) => {
        setDragPreview((current) => {
            if (current?.date === date && current.startTime === startTime) {
                return current;
            }
            return { date, startTime };
        });
    };

    const getStartTimeFromColumnPosition = (event: DragEvent<HTMLDivElement>): string => {
        const rect = event.currentTarget.getBoundingClientRect();
        const y = event.clientY - rect.top;
        const scaledSlotHeight = SLOT_HEIGHT_PX * zoomScale;
        const slotIndex = Math.max(
            0,
            Math.min(timeSlots.length - 1, Math.floor(y / scaledSlotHeight))
        );
        return minutesToTimeString(DAY_START_MINUTES + slotIndex * SLOT_MINUTES);
    };

    // Robust scroll preservation that survives async re-renders (DB updates, state changes)
    const pendingScrollRestoreRef = useRef<{ top: number; left: number; rendersLeft: number } | null>(null);
    const programmaticScrollRef = useRef(false);

    useLayoutEffect(() => {
        const pending = pendingScrollRestoreRef.current;
        if (pending && zoomContainerRef.current) {
            programmaticScrollRef.current = true;
            zoomContainerRef.current.scrollTop = pending.top;
            zoomContainerRef.current.scrollLeft = pending.left;
            // Reset flag after browser processes the scroll event
            setTimeout(() => { programmaticScrollRef.current = false; }, 80);
            pending.rendersLeft--;
            if (pending.rendersLeft <= 0) {
                pendingScrollRestoreRef.current = null;
            }
        }
    });

    // Cancel scroll restoration when the USER scrolls (not our programmatic restore)
    useEffect(() => {
        const container = zoomContainerRef.current;
        if (!container) return;
        const handleUserScroll = () => {
            if (!programmaticScrollRef.current && pendingScrollRestoreRef.current) {
                pendingScrollRestoreRef.current = null;
            }
        };
        container.addEventListener('scroll', handleUserScroll, { passive: true });
        return () => container.removeEventListener('scroll', handleUserScroll);
    }, []);

    const preserveScrollPosition = (callback: () => void) => {
        const scrollTop = zoomContainerRef.current?.scrollTop ?? 0;
        const scrollLeft = zoomContainerRef.current?.scrollLeft ?? 0;
        // Persist restoration across multiple re-renders to catch async DB updates
        pendingScrollRestoreRef.current = { top: scrollTop, left: scrollLeft, rendersLeft: 10 };
        callback();
    };

    const moveAppointmentToSlot = (appointmentId: string, date: string, startTime: string) => {
        const existingAppointment = appointments.find((apt) => apt.id === appointmentId);
        if (!existingAppointment) {
            return;
        }

        if (
            existingAppointment.date === date &&
            existingAppointment.startTime === startTime
        ) {
            return;
        }

        preserveScrollPosition(() => {
            void update(appointmentId, {
                date,
                startTime,
            });
        });
    };

    const copyAppointmentToSlot = async (appointmentId: string, date: string, startTime: string) => {
        const source = appointments.find((apt) => apt.id === appointmentId);
        if (!source) return;

        preserveScrollPosition(() => {
            void create({
                patientId: source.patientId,
                date,
                startTime,
                duration: source.duration,
                visitType: source.visitType,
                notes: source.notes,
                status: 'scheduled',
            });
        });
    };

    const handleDayDrop = (
        event: DragEvent<HTMLDivElement>,
        date: string
    ) => {
        event.preventDefault();
        const droppedId = event.dataTransfer.getData("text/plain") || draggingAppointmentId;

        // Lock scroll before any state changes
        const scrollTop = zoomContainerRef.current?.scrollTop ?? 0;
        const scrollLeft = zoomContainerRef.current?.scrollLeft ?? 0;
        pendingScrollRestoreRef.current = { top: scrollTop, left: scrollLeft, rendersLeft: 10 };

        setDraggingAppointmentId(null);
        setDragPreview(null);

        if (!droppedId) {
            return;
        }

        const startTime = getStartTimeFromColumnPosition(event);

        moveAppointmentToSlot(droppedId, date, startTime);
        setMoveAppointmentId(null);
        triggerSync();
        suppressNextSlotClickRef.current = true;
        if (suppressClickTimerRef.current) {
            window.clearTimeout(suppressClickTimerRef.current);
        }
        suppressClickTimerRef.current = window.setTimeout(() => {
            suppressNextSlotClickRef.current = false;
        }, 0);
    };

    const handleSlotDrop = (
        event: DragEvent<HTMLButtonElement>,
        date: string,
        startTime: string
    ) => {
        event.preventDefault();
        event.stopPropagation();
        const droppedId = event.dataTransfer.getData("text/plain") || draggingAppointmentId;
        setDraggingAppointmentId(null);
        setDragPreview(null);

        if (!droppedId) {
            return;
        }

        moveAppointmentToSlot(droppedId, date, startTime);
        setMoveAppointmentId(null);
        triggerSync();
        suppressNextSlotClickRef.current = true;
        if (suppressClickTimerRef.current) {
            window.clearTimeout(suppressClickTimerRef.current);
        }
        suppressClickTimerRef.current = window.setTimeout(() => {
            suppressNextSlotClickRef.current = false;
        }, 0);
    };

    // Touch-based drag for mobile appointment moving
    const TOUCH_DRAG_HOLD_MS = 200;

    const handleChipTouchStart = (event: TouchEvent<HTMLDivElement>, appointmentId: string) => {
        // Don't start touch drag if already resizing
        if (resizeSessionRef.current || resizingAppointmentId) return;

        const touch = event.touches[0];
        touchDragRef.current = {
            appointmentId,
            startX: touch.clientX,
            startY: touch.clientY,
            activated: false,
        };
        touchDragPreviewRef.current = null;

        touchDragTimerRef.current = window.setTimeout(() => {
            if (touchDragRef.current && !touchDragRef.current.activated) {
                // Lock scroll position BEFORE state changes that trigger re-renders
                const scrollTop = zoomContainerRef.current?.scrollTop ?? 0;
                const scrollLeft = zoomContainerRef.current?.scrollLeft ?? 0;
                pendingScrollRestoreRef.current = { top: scrollTop, left: scrollLeft, rendersLeft: 10 };

                touchDragRef.current.activated = true;
                setDraggingAppointmentId(appointmentId);
                // Don't set moveAppointmentId here — that's only for the
                // action-sheet "click slot to place" path. Setting it during
                // touch drag would show the "Moving..." banner, which causes
                // a layout shift that pushes the grid down mid-drag.
                const existing = appointments.find((a) => a.id === appointmentId);
                if (existing) {
                    const preview = { date: existing.date, startTime: existing.startTime };
                    setDragPreview(preview);
                    touchDragPreviewRef.current = preview;
                }
                // Show floating ghost at finger position
                if (touchDragRef.current) {
                    const patient = patients.find((p) => p.id === existing?.patientId);
                    setTouchDragGhost({
                        x: touchDragRef.current.startX,
                        y: touchDragRef.current.startY,
                        name: patient ? `${patient.lastName}, ${patient.firstName}` : 'Appointment',
                        duration: existing?.duration ?? 30,
                    });
                }
                if (navigator.vibrate) navigator.vibrate(30);
            }
        }, TOUCH_DRAG_HOLD_MS);
    };

    const handleChipTouchEnd = () => {
        const state = touchDragRef.current;

        // Lock scroll position BEFORE any state changes
        if (state?.activated) {
            const scrollTop = zoomContainerRef.current?.scrollTop ?? 0;
            const scrollLeft = zoomContainerRef.current?.scrollLeft ?? 0;
            pendingScrollRestoreRef.current = { top: scrollTop, left: scrollLeft, rendersLeft: 10 };
        }

        if (state?.activated && touchDragPreviewRef.current) {
            moveAppointmentToSlot(
                state.appointmentId,
                touchDragPreviewRef.current.date,
                touchDragPreviewRef.current.startTime
            );
            triggerSync();
            suppressNextSlotClickRef.current = true;
            suppressNextChipClickRef.current = true;
            // Reset suppression after synthetic click events fire (~300ms after touchend)
            if (suppressClickTimerRef.current) window.clearTimeout(suppressClickTimerRef.current);
            suppressClickTimerRef.current = window.setTimeout(() => {
                suppressNextSlotClickRef.current = false;
            }, 400);
            if (suppressChipClickTimerRef.current) window.clearTimeout(suppressChipClickTimerRef.current);
            suppressChipClickTimerRef.current = window.setTimeout(() => {
                suppressNextChipClickRef.current = false;
            }, 400);
        }

        if (touchDragTimerRef.current) {
            clearTimeout(touchDragTimerRef.current);
            touchDragTimerRef.current = null;
        }
        touchDragRef.current = null;
        touchDragPreviewRef.current = null;
        setDraggingAppointmentId(null);
        setDragPreview(null);
        setTouchDragGhost(null);
    };

    // Pinch-to-zoom handlers for mobile
    const getDistance = (touch1: Touch, touch2: Touch): number => {
        const dx = touch1.clientX - touch2.clientX;
        const dy = touch1.clientY - touch2.clientY;
        return Math.sqrt(dx * dx + dy * dy);
    };

    const handleZoomTouchStart = useCallback((event: TouchEvent) => {
        if (event.touches.length === 2) {
            // Two fingers - start pinch
            const distance = getDistance(event.touches[0], event.touches[1]);
            pinchStateRef.current = {
                initialDistance: distance,
                initialScale: zoomScale,
            };
        }
    }, [zoomScale]);

    const handleZoomTouchMove = useCallback((event: TouchEvent) => {
        if (event.touches.length === 2 && pinchStateRef.current) {
            event.preventDefault();
            const distance = getDistance(event.touches[0], event.touches[1]);
            const scaleFactor = distance / pinchStateRef.current.initialDistance;
            const newScale = Math.min(Math.max(pinchStateRef.current.initialScale * scaleFactor, 0.5), 2);
            setZoomScale(newScale);
        }
    }, []);

    const handleZoomTouchEnd = useCallback(() => {
        pinchStateRef.current = null;
    }, []);

    const suppressNextChipClick = () => {
        suppressNextChipClickRef.current = true;
        if (suppressChipClickTimerRef.current) {
            window.clearTimeout(suppressChipClickTimerRef.current);
        }
        suppressChipClickTimerRef.current = window.setTimeout(() => {
            suppressNextChipClickRef.current = false;
        }, 0);
    };

    const handleAppointmentChipClick = (
        event: MouseEvent<HTMLDivElement>,
        appointmentId: string
    ) => {
        event.stopPropagation();
        if (suppressNextChipClickRef.current || resizingAppointmentId !== null) {
            return;
        }
        // Open action sheet for mobile-friendly actions
        setActionSheetAppointmentId(appointmentId);
    };

    const handleAppointmentLongPress = (
        event: MouseEvent<HTMLDivElement>,
        appointmentId: string
    ) => {
        event.stopPropagation();
        // Toggle move mode on long press / right click
        setMoveAppointmentId((current) => (current === appointmentId ? null : appointmentId));
    };

    const handleSlotClick = (date: string, startTime: string) => {
        if (suppressNextSlotClickRef.current) {
            return;
        }

        // Handle move mode - placing an appointment
        if (moveAppointmentId) {
            void moveAppointmentToSlot(moveAppointmentId, date, startTime);
            setMoveAppointmentId(null);
            triggerSync();
            return;
        }
        // Handle copy mode - duplicating an appointment to a new slot
        if (copyAppointmentId) {
            void copyAppointmentToSlot(copyAppointmentId, date, startTime);
            setCopyAppointmentId(null);
            triggerSync();
            return;
        }
        // For adding new appointments, require long press (handled separately)
    };

    const LONG_PRESS_DURATION_MS = 400;

    const handleSlotLongPressStart = (date: string, startTime: string) => {
        // Don't start long press if we're in move or copy mode
        if (moveAppointmentId || copyAppointmentId) {
            return;
        }

        slotLongPressTargetRef.current = { date, startTime };
        if (slotLongPressTimerRef.current) {
            window.clearTimeout(slotLongPressTimerRef.current);
        }
        slotLongPressTimerRef.current = window.setTimeout(() => {
            if (slotLongPressTargetRef.current) {
                openAddAppointment(slotLongPressTargetRef.current.date, slotLongPressTargetRef.current.startTime);
                slotLongPressTargetRef.current = null;
            }
        }, LONG_PRESS_DURATION_MS);
    };

    const handleSlotLongPressEnd = () => {
        if (slotLongPressTimerRef.current) {
            window.clearTimeout(slotLongPressTimerRef.current);
            slotLongPressTimerRef.current = null;
        }
        slotLongPressTargetRef.current = null;
    };

    const handleDeleteAppointment = async (appointment: Appointment) => {
        const patientName = getPatientName(appointment.patientId);
        const confirmed = window.confirm(
            `Delete appointment for ${patientName} on ${appointment.date} at ${appointment.startTime}?`
        );
        if (!confirmed) {
            return;
        }

        if (moveAppointmentId === appointment.id) {
            setMoveAppointmentId(null);
        }
        if (copyAppointmentId === appointment.id) {
            setCopyAppointmentId(null);
        }
        if (draggingAppointmentId === appointment.id) {
            setDraggingAppointmentId(null);
        }
        if (resizingAppointmentId === appointment.id) {
            setResizingAppointmentId(null);
        }
        if (resizeSessionRef.current?.appointmentId === appointment.id) {
            resizeSessionRef.current = null;
            resizeDraftRef.current = null;
        }
        setDraftRenderById((current) => {
            const next = { ...current };
            delete next[appointment.id];
            return next;
        });

        await deleteAppointment(appointment.id);
        triggerSync();
    };

    const handleAutoArrangeDay = async (date: string) => {
        const dayAppointments = (appointmentsByDay[date] ?? [])
            .slice()
            .sort((a, b) => a.startTime.localeCompare(b.startTime));

        if (dayAppointments.length === 0) {
            return;
        }

        setAutoArrangeError(null);
        setAutoArrangeInProgressByDay((current) => ({
            ...current,
            [date]: true,
        }));

        try {
            // Start optimized routes at 9:00 AM
            const OPTIMIZE_START_MINUTES = 9 * 60;
            const dayStartMinutes = OPTIMIZE_START_MINUTES;

            const withCoordinates: Array<{
                appointment: Appointment;
                lat: number;
                lng: number;
            }> = [];
            const withoutCoordinates: Appointment[] = [];

            for (const appointment of dayAppointments) {
                const coords = await resolvePatientCoordinatesForRouting(appointment.patientId);
                if (coords) {
                    withCoordinates.push({
                        appointment,
                        lat: coords.lat,
                        lng: coords.lng,
                    });
                } else {
                    withoutCoordinates.push(appointment);
                }
            }

            const homeBase = getHomeBase();
            const optimizedWithCoordinates = orderByFarthestFromHome(
                withCoordinates,
                homeCoordinates ?? { lat: homeBase.lat, lng: homeBase.lng }
            );

            const orderedAppointments = [
                ...optimizedWithCoordinates.map((item) => item.appointment),
                ...withoutCoordinates,
            ];

            // Start at 9:00 AM (540 minutes from midnight)
            let nextStartMinutes = 540;
            for (const appointment of orderedAppointments) {
                // Snap to 15-minute slots
                const snappedMinutes = Math.round(nextStartMinutes / 15) * 15;
                const hours = Math.floor(snappedMinutes / 60);
                const mins = snappedMinutes % 60;
                const nextStartTime = `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;

                // Always update to force the new time
                await update(appointment.id, {
                    date,
                    startTime: nextStartTime,
                });

                nextStartMinutes = snappedMinutes + appointment.duration;
            }

            // Reload appointments to ensure UI reflects the changes
            await loadByRange(weekStart, weekEnd);
            setSelectedDate(date);
            triggerSync();
        } catch (err) {
            setAutoArrangeError(
                err instanceof Error
                    ? err.message
                    : "Failed to auto arrange appointments for this day."
            );
        } finally {
            setAutoArrangeInProgressByDay((current) => ({
                ...current,
                [date]: false,
            }));
        }
    };

    const handleClearWeek = async () => {
        const weekAppointments = (await db.appointments
            .where("date")
            .between(weekStart, weekEnd, true, true)
            .toArray())
            .slice()
            .sort((a, b) =>
                a.date === b.date ? a.startTime.localeCompare(b.startTime) : a.date.localeCompare(b.date)
            );

        if (weekAppointments.length === 0) {
            setWeekActionError(null);
            setWeekActionMessage("No appointments to clear for this week.");
            return;
        }

        const confirmed = window.confirm(
            `Clear all ${weekAppointments.length} appointment${weekAppointments.length === 1 ? "" : "s"} from ${weekStart} to ${weekEnd}?`
        );
        if (!confirmed) {
            return;
        }

        setWeekActionInProgress(true);
        setWeekActionError(null);
        setWeekActionMessage(null);
        setMoveAppointmentId(null);
        setDraggingAppointmentId(null);
        setResizingAppointmentId(null);
        setDetailAppointmentId(null);
        setDraftRenderById({});

        try {
            const snapshot: ClearedWeekSnapshot = {
                weekStart,
                weekEnd,
                appointments: weekAppointments.map((appointment) => ({
                    patientId: appointment.patientId,
                    date: appointment.date,
                    startTime: appointment.startTime,
                    duration: appointment.duration,
                    status: appointment.status,
                    notes: appointment.notes,
                })),
            };

            setLastClearedWeekSnapshot(snapshot);

            let remainingAppointments = weekAppointments;
            for (let attempt = 0; attempt < 2 && remainingAppointments.length > 0; attempt += 1) {
                for (const appointment of remainingAppointments) {
                    await deleteAppointment(appointment.id);
                }

                remainingAppointments = await db.appointments
                    .where("date")
                    .between(weekStart, weekEnd, true, true)
                    .toArray();
            }

            await loadByRange(weekStart, weekEnd);
            triggerSync();

            if (remainingAppointments.length > 0) {
                setWeekActionError(
                    `Cleared most appointments, but ${remainingAppointments.length} still remained. Press Clear Week again to remove them.`
                );
            } else {
                setWeekActionMessage(
                    `Cleared ${weekAppointments.length} appointment${weekAppointments.length === 1 ? "" : "s"} for this week.`
                );
            }
        } catch (err) {
            setWeekActionError(
                err instanceof Error ? err.message : "Failed to clear appointments for this week."
            );
        } finally {
            setWeekActionInProgress(false);
        }
    };

    const handleUndoClearWeek = async () => {
        if (!lastClearedWeekSnapshot || lastClearedWeekSnapshot.appointments.length === 0) {
            setWeekActionError(null);
            setWeekActionMessage("There is no cleared week to restore.");
            return;
        }

        const count = lastClearedWeekSnapshot.appointments.length;
        const confirmed = window.confirm(
            `Restore ${count} appointment${count === 1 ? "" : "s"} back to ${lastClearedWeekSnapshot.weekStart} to ${lastClearedWeekSnapshot.weekEnd}?`
        );
        if (!confirmed) {
            return;
        }

        setWeekActionInProgress(true);
        setWeekActionError(null);
        setWeekActionMessage(null);

        try {
            const orderedAppointments = [...lastClearedWeekSnapshot.appointments].sort((a, b) =>
                a.date === b.date ? a.startTime.localeCompare(b.startTime) : a.date.localeCompare(b.date)
            );

            for (const appointment of orderedAppointments) {
                await create({
                    patientId: appointment.patientId,
                    date: appointment.date,
                    startTime: appointment.startTime,
                    duration: appointment.duration,
                    status: appointment.status,
                    syncStatus: "local",
                    notes: appointment.notes,
                });
            }

            await loadByRange(lastClearedWeekSnapshot.weekStart, lastClearedWeekSnapshot.weekEnd);

            setWeekActionMessage(`Restored ${count} appointment${count === 1 ? "" : "s"} to the week.`);
            setLastClearedWeekSnapshot(null);
            triggerSync();
        } catch (err) {
            setWeekActionError(
                err instanceof Error ? err.message : "Failed to restore the cleared week."
            );
        } finally {
            setWeekActionInProgress(false);
        }
    };

    const handleOpenDayMap = async () => {
        const activeDayAppointments = selectedDayAppointments.filter(
            (appointment) => appointment.status !== "cancelled"
        );

        if (activeDayAppointments.length === 0) {
            setDayMapError("No appointments for this day.");
            setDayMapInfoMessage(null);
            setDayMapPoints([]);
            setIsDayMapOpen(true);
            return;
        }

        setDayMapError(null);
        setDayMapInfoMessage(null);
        setIsDayMapLoading(true);
        setIsDayMapOpen(true);

        try {
            const points: DayMapPoint[] = [];
            const homeBase = getHomeBase();
            const home = homeCoordinates ?? { lat: homeBase.lat, lng: homeBase.lng };
            points.push({
                id: "home",
                label: "Home",
                lat: home.lat,
                lng: home.lng,
                isHome: true,
            });

            const seenPatientIds = new Set<string>();
            let unresolvedCount = 0;

            for (const appointment of activeDayAppointments) {
                if (seenPatientIds.has(appointment.patientId)) {
                    continue;
                }
                seenPatientIds.add(appointment.patientId);

                const patient = getPatient(appointment.patientId);
                const coords = await resolvePatientCoordinatesForRouting(appointment.patientId);
                if (!coords) {
                    unresolvedCount += 1;
                    continue;
                }

                points.push({
                    id: appointment.id,
                    label: `${appointment.startTime} ${patient?.fullName ?? "Unknown Patient"}`,
                    lat: coords.lat,
                    lng: coords.lng,
                    isHome: false,
                });
            }

            if (points.length === 1) {
                setDayMapError("Could not map any patient addresses for this day.");
                setDayMapInfoMessage(null);
                setDayMapPoints(points);
                return;
            }

            if (unresolvedCount > 0) {
                setDayMapInfoMessage(
                    `${unresolvedCount} patient${unresolvedCount === 1 ? "" : "s"} could not be mapped (missing/invalid address).`
                );
            } else {
                setDayMapInfoMessage(null);
            }

            setDayMapPoints(points);
        } catch (err) {
            setDayMapError(err instanceof Error ? err.message : "Failed to build day map.");
            setDayMapPoints([]);
        } finally {
            setIsDayMapLoading(false);
        }
    };

    const handleCloseDayMap = () => {
        setIsDayMapOpen(false);
        setIsDayMapLoading(false);
    };

    const getRenderedStartMinutes = (appointment: Appointment): number => {
        return draftRenderById[appointment.id]?.startMinutes ?? timeStringToMinutes(appointment.startTime);
    };

    const getRenderedDuration = (appointment: Appointment): number => {
        return draftRenderById[appointment.id]?.duration ?? appointment.duration;
    };

    const handleResizeStart = (
        event: MouseEvent<HTMLButtonElement> | TouchEvent<HTMLDivElement> | null,
        appointment: Appointment,
        edge: "top" | "bottom",
        rawClientY?: number
    ) => {
        if (event) {
            event.stopPropagation();
            event.preventDefault();
        }
        suppressNextChipClick();
        setMoveAppointmentId(null);
        // Cancel any active touch drag when resize starts
        if (touchDragTimerRef.current) {
            clearTimeout(touchDragTimerRef.current);
            touchDragTimerRef.current = null;
        }
        touchDragRef.current = null;
        setResizingAppointmentId(appointment.id);
        const initialStartMinutes = getRenderedStartMinutes(appointment);
        const initialDuration = getRenderedDuration(appointment);

        // Get clientY from explicit value, touch event, or mouse event
        let clientY = rawClientY ?? 0;
        if (!rawClientY && event) {
            clientY = 'touches' in event
                ? event.touches[0].clientY
                : (event as unknown as globalThis.MouseEvent).clientY;
        }

        resizeSessionRef.current = {
            appointmentId: appointment.id,
            startY: clientY,
            edge,
            initialStartMinutes,
            initialDuration,
            initialEndMinutes: initialStartMinutes + initialDuration,
        };
        resizeDraftRef.current = {
            startMinutes: initialStartMinutes,
            duration: initialDuration,
        };
    };

    const RESIZE_LONG_PRESS_DURATION_MS = 300;

    const handleResizeTouchStart = (
        event: TouchEvent<HTMLDivElement>,
        appointment: Appointment,
        edge: "top" | "bottom"
    ) => {
        event.stopPropagation();
        // Store clientY immediately to avoid stale event references
        const clientY = event.touches[0].clientY;
        resizeLongPressDataRef.current = { clientY, appointment, edge };

        if (resizeLongPressTimerRef.current) {
            window.clearTimeout(resizeLongPressTimerRef.current);
        }

        resizeLongPressTimerRef.current = window.setTimeout(() => {
            const data = resizeLongPressDataRef.current;
            if (data) {
                // Start resize using the stored clientY value
                handleResizeStart(null, data.appointment, data.edge, data.clientY);
                resizeLongPressDataRef.current = null;
            }
        }, RESIZE_LONG_PRESS_DURATION_MS);
    };

    const handleResizeTouchEnd = () => {
        if (resizeLongPressTimerRef.current) {
            window.clearTimeout(resizeLongPressTimerRef.current);
            resizeLongPressTimerRef.current = null;
        }
        resizeLongPressDataRef.current = null;
    };

    useEffect(() => {
        const handleMove = (clientY: number) => {
            const session = resizeSessionRef.current;
            if (!session) {
                return;
            }
            const deltaSlots = Math.round((clientY - session.startY) / SLOT_HEIGHT_PX);

            let nextStartMinutes = session.initialStartMinutes;
            let nextDuration = session.initialDuration;
            if (session.edge === "bottom") {
                const maxDuration = Math.max(
                    MIN_DURATION_MINUTES,
                    DAY_END_MINUTES - session.initialStartMinutes
                );
                const proposedDuration =
                    session.initialDuration + deltaSlots * SLOT_MINUTES;
                nextDuration = Math.max(
                    MIN_DURATION_MINUTES,
                    Math.min(maxDuration, proposedDuration)
                );
            } else {
                const proposedStart =
                    session.initialStartMinutes + deltaSlots * SLOT_MINUTES;
                nextStartMinutes = Math.max(
                    DAY_START_MINUTES,
                    Math.min(
                        session.initialEndMinutes - MIN_DURATION_MINUTES,
                        proposedStart
                    )
                );
                nextDuration = session.initialEndMinutes - nextStartMinutes;
            }

            const snappedStart =
                Math.round(nextStartMinutes / SLOT_MINUTES) * SLOT_MINUTES;
            const snappedDuration = Math.max(
                MIN_DURATION_MINUTES,
                Math.round(nextDuration / SLOT_MINUTES) * SLOT_MINUTES
            );
            resizeDraftRef.current = {
                startMinutes: snappedStart,
                duration: snappedDuration,
            };
            setDraftRenderById((current) => ({
                ...current,
                [session.appointmentId]: {
                    startMinutes: snappedStart,
                    duration: snappedDuration,
                },
            }));
        };

        const handleMouseMove = (event: globalThis.MouseEvent) => {
            handleMove(event.clientY);
        };

        const handleTouchMove = (event: TouchEvent) => {
            if (!resizeSessionRef.current) return;
            event.preventDefault(); // Prevent scrolling while resizing
            handleMove(event.touches[0].clientY);
        };

        const handleEnd = () => {
            const session = resizeSessionRef.current;
            if (!session) {
                return;
            }

            // Lock scroll position before any state changes
            const scrollTop = zoomContainerRef.current?.scrollTop ?? 0;
            const scrollLeft = zoomContainerRef.current?.scrollLeft ?? 0;
            pendingScrollRestoreRef.current = { top: scrollTop, left: scrollLeft, rendersLeft: 10 };

            const nextRender = resizeDraftRef.current ?? {
                startMinutes: session.initialStartMinutes,
                duration: session.initialDuration,
            };
            const changed =
                nextRender.startMinutes !== session.initialStartMinutes ||
                nextRender.duration !== session.initialDuration;

            setResizingAppointmentId(null);
            resizeSessionRef.current = null;
            resizeDraftRef.current = null;
            suppressNextChipClick();

            if (changed) {
                // Update DB first, THEN clear the draft so the chip doesn't snap back
                void update(session.appointmentId, {
                    startTime: minutesToTimeString(nextRender.startMinutes),
                    duration: nextRender.duration,
                }).then(() => {
                    setDraftRenderById((current) => {
                        const next = { ...current };
                        delete next[session.appointmentId];
                        return next;
                    });
                    triggerSync();
                });
            } else {
                // No change — just clear the draft
                setDraftRenderById((current) => {
                    const next = { ...current };
                    delete next[session.appointmentId];
                    return next;
                });
            }
        };

        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleEnd);
        window.addEventListener("touchmove", handleTouchMove, { passive: false });
        window.addEventListener("touchend", handleEnd);
        window.addEventListener("touchcancel", handleEnd);
        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleEnd);
            window.removeEventListener("touchmove", handleTouchMove);
            window.removeEventListener("touchend", handleEnd);
            window.removeEventListener("touchcancel", handleEnd);
        };
    }, [update]);

    // Touch-based drag move tracking for mobile appointment dragging
    useEffect(() => {
        const findColumnAtPoint = (x: number, y: number): HTMLElement | null => {
            const columns = document.querySelectorAll<HTMLElement>('[data-column-date]');
            for (const col of columns) {
                const rect = col.getBoundingClientRect();
                if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
                    return col;
                }
            }
            return null;
        };

        const handleTouchDragMove = (event: globalThis.TouchEvent) => {
            const state = touchDragRef.current;
            if (!state) return;

            const touch = event.touches[0];

            // Before activation: cancel if finger moves too far (user is scrolling)
            if (!state.activated) {
                const dx = Math.abs(touch.clientX - state.startX);
                const dy = Math.abs(touch.clientY - state.startY);
                if (dx > 10 || dy > 10) {
                    if (touchDragTimerRef.current) {
                        clearTimeout(touchDragTimerRef.current);
                        touchDragTimerRef.current = null;
                    }
                    touchDragRef.current = null;
                }
                return;
            }

            // Drag is active — prevent scrolling
            event.preventDefault();

            // Update floating ghost position (follows finger directly)
            setTouchDragGhost((prev) => {
                if (!prev) return prev;
                if (prev.x === touch.clientX && prev.y === touch.clientY) return prev;
                return { ...prev, x: touch.clientX, y: touch.clientY };
            });

            const columnEl = findColumnAtPoint(touch.clientX, touch.clientY);
            if (columnEl) {
                const date = columnEl.getAttribute('data-column-date');
                const rect = columnEl.getBoundingClientRect();
                const y = touch.clientY - rect.top;
                const scaledSlotHeight = SLOT_HEIGHT_PX * zoomScale;
                const slotIndex = Math.max(
                    0,
                    Math.min(timeSlots.length - 1, Math.floor(y / scaledSlotHeight))
                );
                const startTime = minutesToTimeString(DAY_START_MINUTES + slotIndex * SLOT_MINUTES);
                if (date) {
                    const preview = { date, startTime };
                    touchDragPreviewRef.current = preview;
                    setDragPreview((prev) => {
                        if (prev?.date === date && prev.startTime === startTime) return prev;
                        return preview;
                    });
                }
            }
        };

        window.addEventListener('touchmove', handleTouchDragMove, { passive: false });
        return () => {
            window.removeEventListener('touchmove', handleTouchDragMove);
        };
    }, [zoomScale, timeSlots.length]);

    useEffect(() => {
        return () => {
            if (suppressClickTimerRef.current) {
                window.clearTimeout(suppressClickTimerRef.current);
            }
            if (suppressChipClickTimerRef.current) {
                window.clearTimeout(suppressChipClickTimerRef.current);
            }
            if (slotLongPressTimerRef.current) {
                window.clearTimeout(slotLongPressTimerRef.current);
            }
            if (resizeLongPressTimerRef.current) {
                window.clearTimeout(resizeLongPressTimerRef.current);
            }
            if (touchDragTimerRef.current) {
                window.clearTimeout(touchDragTimerRef.current);
            }
        };
    }, []);

    // Fetch external calendar events when week or enabled calendars change
    useEffect(() => {
        if (!isSignedIn()) {
            setExternalEvents([]);
            return;
        }

        let cancelled = false;

        const fetchExternalEvents = async () => {
            // Get enabled external calendars (exclude pt-appointments which is our internal calendar)
            const enabledExternalCalendars = googleCalendars.filter(
                (cal) => enabledCalendars[cal.id] !== false
            );

            if (enabledExternalCalendars.length === 0) {
                setExternalEvents([]);
                return;
            }

            // Build time range for the week
            const timeMin = new Date(`${weekStart}T00:00:00`).toISOString();
            const timeMax = new Date(`${weekEnd}T23:59:59`).toISOString();

            const allEvents: ExternalCalendarEvent[] = [];

            // Fetch events from each enabled calendar in parallel
            const results = await Promise.allSettled(
                enabledExternalCalendars.map(async (cal) => {
                    try {
                        const result = await fetchCalendarEvents(cal.id, timeMin, timeMax);
                        if (result.error) {
                            console.warn(`Calendar ${cal.summary} returned error: ${result.error}`);
                        }
                        return result.events
                            // Filter out PT Scheduler appointments (they start with "PT: ")
                            .filter((event) => !event.summary.startsWith("PT: "))
                            .map((event) => ({
                                id: event.id,
                                calendarId: cal.id,
                                summary: event.summary,
                                startDateTime: event.startDateTime,
                                endDateTime: event.endDateTime,
                                location: event.location,
                                backgroundColor: cal.backgroundColor,
                            }));
                    } catch (err) {
                        console.warn(`Failed to fetch events from ${cal.summary}:`, err);
                        return [];
                    }
                })
            );

            for (const result of results) {
                if (result.status === "fulfilled") {
                    allEvents.push(...result.value);
                }
            }

            if (!cancelled) {
                setExternalEvents(allEvents);
            }
        };

        void fetchExternalEvents();

        return () => {
            cancelled = true;
        };
    }, [weekStart, weekEnd, googleCalendars, enabledCalendars, setExternalEvents]);

    const dayMapDirectionsHref = useMemo(() => {
        const homePoint = dayMapPoints.find((point) => point.isHome);
        if (!homePoint) {
            return null;
        }

        const patientStops = dayMapPoints
            .filter((point) => !point.isHome)
            .map((point) => ({ lat: point.lat, lng: point.lng }));
        return buildGoogleMapsDirectionsFromCoordinatesHref(
            { lat: homePoint.lat, lng: homePoint.lng },
            patientStops
        );
    }, [dayMapPoints]);

    useEffect(() => {
        let cancelled = false;

        const renderMap = async () => {
            if (!isDayMapOpen || !dayMapContainerRef.current || dayMapPoints.length === 0) {
                return;
            }

            const L = await import("leaflet");
            if (cancelled || !dayMapContainerRef.current) {
                return;
            }

            if (!dayMapInstanceRef.current) {
                dayMapInstanceRef.current = L.map(dayMapContainerRef.current, {
                    zoomControl: true,
                    attributionControl: true,
                });

                L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
                    maxZoom: 19,
                    attribution: "&copy; OpenStreetMap contributors",
                }).addTo(dayMapInstanceRef.current);

                dayMapLayerRef.current = L.layerGroup().addTo(dayMapInstanceRef.current);
            }

            const map = dayMapInstanceRef.current;
            const layer = dayMapLayerRef.current;
            if (!map || !layer) {
                return;
            }

            layer.clearLayers();
            const bounds = L.latLngBounds([]);

            for (let index = 0; index < dayMapPoints.length; index += 1) {
                const point = dayMapPoints[index];
                const color = point.isHome ? "#d93025" : "#1a73e8";
                const marker = L.circleMarker([point.lat, point.lng], {
                    radius: point.isHome ? 9 : 7,
                    color,
                    weight: 2,
                    fillColor: color,
                    fillOpacity: 0.9,
                });
                marker.bindTooltip(
                    point.isHome ? "Home" : `${index}. ${point.label}`,
                    {
                        direction: "top",
                        offset: [0, -4],
                    }
                );
                marker.addTo(layer);
                bounds.extend([point.lat, point.lng]);
            }

            if (dayMapPoints.length > 1) {
                const routeCoordinates = dayMapPoints.map((point) => [point.lat, point.lng]) as [
                    number,
                    number
                ][];
                L.polyline(routeCoordinates, {
                    color: "#1a73e8",
                    opacity: 0.55,
                    weight: 3,
                    dashArray: "6,6",
                }).addTo(layer);
            }

            if (bounds.isValid()) {
                map.fitBounds(bounds.pad(0.2), { maxZoom: 14 });
            }

            window.setTimeout(() => {
                map.invalidateSize();
            }, 0);
        };

        void renderMap();

        return () => {
            cancelled = true;
        };
    }, [isDayMapOpen, dayMapPoints]);

    useEffect(() => {
        return () => {
            dayMapInstanceRef.current?.remove();
            dayMapInstanceRef.current = null;
            dayMapLayerRef.current = null;
        };
    }, []);

    // Current time line position - updates every minute
    const [currentTimePosition, setCurrentTimePosition] = useState<number | null>(() => {
        const now = new Date();
        const currentMinutes = now.getHours() * 60 + now.getMinutes();
        if (currentMinutes < DAY_START_MINUTES || currentMinutes > DAY_END_MINUTES) {
            return null;
        }
        return ((currentMinutes - DAY_START_MINUTES) / SLOT_MINUTES) * SLOT_HEIGHT_PX;
    });

    useEffect(() => {
        const updateTimePosition = () => {
            const now = new Date();
            const currentMinutes = now.getHours() * 60 + now.getMinutes();
            if (currentMinutes < DAY_START_MINUTES || currentMinutes > DAY_END_MINUTES) {
                setCurrentTimePosition(null);
            } else {
                setCurrentTimePosition(((currentMinutes - DAY_START_MINUTES) / SLOT_MINUTES) * SLOT_HEIGHT_PX);
            }
        };
        const interval = setInterval(updateTimePosition, 60_000);
        return () => clearInterval(interval);
    }, []);

    // Check if today is in the current week view
    const todayInWeek = weekDates.includes(todayIso());

    return (
        <div className="h-full min-h-0 flex flex-col bg-[var(--color-background)] transition-colors duration-200">
            {/* Header with navigation */}
            <div className={`flex items-center justify-between px-2 sm:px-4 py-1.5 border-b border-[var(--color-border-light)] bg-[var(--color-surface)] header-nav transition-colors duration-200 ${isScrolled ? 'scrolled' : ''}`}>
                <div className="flex items-center gap-1.5 sm:gap-2">
                    <button
                        onClick={() => setSelectedDate(todayIso())}
                        className="px-2.5 h-7 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-md text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-text-tertiary)] active:bg-[var(--color-surface-hover)] transition-all shadow-sm"
                    >
                        Today
                    </button>
                    <div className="flex items-center bg-[var(--color-surface-hover)] rounded-md">
                        <button
                            onClick={() => navigateWeek(-1)}
                            className="w-7 h-7 flex items-center justify-center rounded-l-md hover:bg-[var(--color-border)] active:bg-[var(--color-border)] transition-colors"
                            aria-label="Previous week"
                        >
                            <ChevronLeft className="w-4 h-4 text-[var(--color-text-secondary)]" />
                        </button>
                        <div className="w-px h-4 bg-[var(--color-border)]" />
                        <button
                            onClick={() => navigateWeek(1)}
                            className="w-7 h-7 flex items-center justify-center rounded-r-md hover:bg-[var(--color-border)] active:bg-[var(--color-border)] transition-colors"
                            aria-label="Next week"
                        >
                            <ChevronRight className="w-4 h-4 text-[var(--color-text-secondary)]" />
                        </button>
                    </div>
                    <h1 className="text-sm sm:text-base font-semibold text-[var(--color-text-primary)] ml-1">{monthYearDisplay}</h1>
                </div>

                <div className="relative flex items-center gap-1.5">
                    <button
                        onClick={() => void handleOpenDayMap()}
                        disabled={isDayMapLoading}
                        className="hidden sm:flex items-center gap-1.5 px-3 h-8 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-full text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] active:bg-[var(--color-primary-light)] transition-all disabled:opacity-50 shadow-sm"
                    >
                        <Navigation className="w-3.5 h-3.5" />
                        {isDayMapLoading ? "Loading..." : "Map Day"}
                    </button>
                    <button
                        onClick={() => void handleClearWeek()}
                        disabled={weekActionInProgress}
                        className="hidden sm:flex items-center gap-1.5 px-3 h-8 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-full text-xs font-medium text-[var(--color-text-primary)] hover:bg-red-50 dark:hover:bg-red-950 hover:border-red-400 hover:text-red-600 dark:hover:text-red-400 active:bg-red-100 dark:active:bg-red-900 transition-all disabled:opacity-50 shadow-sm"
                    >
                        <X className="w-3.5 h-3.5" />
                        {weekActionInProgress ? "Working..." : "Clear Week"}
                    </button>
                    {lastClearedWeekSnapshot && (
                        <button
                            onClick={() => void handleUndoClearWeek()}
                            disabled={weekActionInProgress}
                            className="hidden sm:flex items-center gap-1.5 px-3 h-8 bg-[var(--color-primary-light)] border border-[var(--color-primary)] rounded-full text-xs font-medium text-[var(--color-primary)] hover:opacity-80 active:opacity-70 transition-all disabled:opacity-50 shadow-sm"
                        >
                            <Clock className="w-3.5 h-3.5" />
                            Undo
                        </button>
                    )}
                    <button
                        onClick={() => setViewDropdownOpen(!viewDropdownOpen)}
                        className="flex items-center gap-0.5 px-2 h-7 bg-[var(--color-surface-hover)] border border-[var(--color-border)] rounded-md text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-border)] active:bg-[var(--color-border)] transition-all"
                    >
                        <span>{viewMode === 'week' ? 'Week' : 'Day'}</span>
                        <ChevronDown className={`w-3.5 h-3.5 text-[var(--color-text-secondary)] transition-transform ${viewDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {viewDropdownOpen && (
                        <div className="absolute top-full right-0 mt-1 bg-[var(--color-surface-elevated)] border border-[var(--color-border-light)] rounded-lg shadow-lg z-50 min-w-[100px] py-1 overflow-hidden dropdown-google">
                            <button
                                onClick={() => {
                                    setViewMode('day');
                                    setViewDropdownOpen(false);
                                }}
                                className={`w-full px-3 py-1.5 text-left text-xs hover:bg-[var(--color-surface-hover)] transition-colors ${viewMode === 'day' ? 'text-[var(--color-primary)] font-medium bg-[var(--color-primary-light)]' : 'text-[var(--color-text-primary)]'}`}
                            >
                                Day view
                            </button>
                            <button
                                onClick={() => {
                                    setViewMode('week');
                                    setViewDropdownOpen(false);
                                }}
                                className={`w-full px-3 py-1.5 text-left text-xs hover:bg-[var(--color-surface-hover)] transition-colors ${viewMode === 'week' ? 'text-[var(--color-primary)] font-medium bg-[var(--color-primary-light)]' : 'text-[var(--color-text-primary)]'}`}
                            >
                                Week view
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Info banner when moving (hide during active touch drag to prevent layout shift) */}
            {selectedMoveAppointment && !draggingAppointmentId && (
                <div className="px-4 py-2 bg-[var(--color-primary-light)] border-b border-[var(--color-border)]">
                    <p className="text-sm text-[var(--color-primary)]">
                        Moving {getPatientName(selectedMoveAppointment.patientId)}. Click a time slot to place it.
                    </p>
                </div>
            )}

            {/* Info banner when copying */}
            {selectedCopyAppointment && !draggingAppointmentId && (
                <div className="px-4 py-2 bg-teal-50 dark:bg-teal-950 border-b border-[var(--color-border)]">
                    <p className="text-sm text-teal-700 dark:text-teal-300">
                        Copying {getPatientName(selectedCopyAppointment.patientId)}. Click a time slot to place the copy.
                    </p>
                </div>
            )}

            {weekActionMessage && (
                <div className="px-4 py-2 bg-green-50 dark:bg-green-950 border-b border-green-200 dark:border-green-800">
                    <p className="text-sm text-green-700 dark:text-green-300">{weekActionMessage}</p>
                </div>
            )}

            {weekActionError && (
                <div className="px-4 py-2 bg-red-50 dark:bg-red-950 border-b border-red-200 dark:border-red-800">
                    <p className="text-sm text-red-700 dark:text-red-300">{weekActionError}</p>
                </div>
            )}

            {/* Main grid area */}
            <div
                ref={zoomContainerRef}
                className="flex-1 min-h-0 overflow-auto"
                style={{
                    WebkitOverflowScrolling: 'touch',
                    overscrollBehavior: 'contain',
                }}
                onScroll={(e) => {
                    const scrollTop = (e.target as HTMLDivElement).scrollTop;
                    setIsScrolled(scrollTop > 0);
                }}
                onTouchStart={handleZoomTouchStart}
                onTouchMove={handleZoomTouchMove}
                onTouchEnd={handleZoomTouchEnd}
            >
                {loading && appointments.length === 0 ? (
                    <ScheduleGridSkeleton />
                ) : (
                    <div
                        className={viewMode === 'day' ? 'min-w-[300px]' : 'min-w-[900px]'}
                        style={{
                            transform: `scale(${zoomScale})`,
                            transformOrigin: 'top left',
                            width: zoomScale < 1 ? `${100 / zoomScale}%` : undefined,
                        }}
                    >
                        {/* Day headers */}
                        <div className="sticky top-0 z-20 bg-[var(--color-surface)]/98 backdrop-blur-sm border-b border-[var(--color-border-light)] transition-colors duration-200">
                            <div className={`grid ${viewMode === 'day' ? 'grid-cols-[60px_1fr]' : 'grid-cols-[60px_repeat(7,1fr)]'}`}>
                                {/* GMT offset */}
                                <div className="py-2 px-1 text-right">
                                    <span className="text-[10px] text-[var(--color-text-tertiary)]">GMT-07</span>
                                </div>

                                {/* Day headers */}
                                {displayDates.map((date) => {
                                    const asDate = parseIsoDate(date);
                                    const dayLabel = asDate.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
                                    const dayNumber = asDate.getDate();
                                    const isToday = date === todayIso();
                                    const isSelected = date === selectedDate;
                                    const dayCount = appointmentsByDay[date]?.length ?? 0;
                                    const isAutoArranging = autoArrangeInProgressByDay[date] ?? false;

                                    return (
                                        <div
                                            key={`header-${date}`}
                                            className="flex flex-col items-center py-2 border-l border-[var(--color-border-light)] first:border-l-0"
                                        >
                                            <span className={`text-[11px] font-medium tracking-wide ${isToday ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-tertiary)]'}`}>
                                                {dayLabel}
                                            </span>
                                            <button
                                                onClick={() => setSelectedDate(date)}
                                                className={`w-7 h-7 flex items-center justify-center rounded-full text-sm font-medium transition-all mt-0.5 ${
                                                    isToday
                                                        ? 'bg-[var(--color-primary)] text-white'
                                                        : isSelected
                                                        ? 'bg-[var(--color-primary-light)] text-[var(--color-primary)]'
                                                        : 'text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]'
                                                }`}
                                            >
                                                {dayNumber}
                                            </button>
                                            {dayCount >= 2 && (
                                                <button
                                                    onClick={() => void handleAutoArrangeDay(date)}
                                                    disabled={isAutoArranging}
                                                    className="mt-1 text-[9px] text-[var(--color-primary)] hover:underline disabled:opacity-50 opacity-70 hover:opacity-100"
                                                >
                                                    {isAutoArranging ? "..." : "Optimize"}
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Time grid */}
                        <div className={`grid ${viewMode === 'day' ? 'grid-cols-[60px_1fr]' : 'grid-cols-[60px_repeat(7,1fr)]'}`}>
                            {/* Time axis */}
                            <div className="border-r border-[var(--color-border)]">
                                {timeSlots.map((slotMinutes, slotIndex) => (
                                    <div
                                        key={`axis-${slotMinutes}`}
                                        className="relative pr-2 text-right"
                                        style={{ height: SLOT_HEIGHT_PX }}
                                    >
                                        {slotIndex % 4 === 0 && (
                                            <span className="absolute -top-2 right-2 text-[10px] text-[var(--color-text-tertiary)]">
                                                {formatAxisTime(slotMinutes)}
                                            </span>
                                        )}
                                    </div>
                                ))}
                            </div>

                            {/* Day columns */}
                            {displayDates.map((date) => {
                                const dayAppointments = appointmentsByDay[date] ?? [];
                                const groupedByStartTime = dayAppointments.reduce<Record<string, Appointment[]>>(
                                    (current, appointment) => {
                                        const renderedStartTime = minutesToTimeString(
                                            getRenderedStartMinutes(appointment)
                                        );
                                        if (!current[renderedStartTime]) {
                                            current[renderedStartTime] = [];
                                        }
                                        current[renderedStartTime].push(appointment);
                                        return current;
                                    },
                                    {}
                                );
                                const isSelectedDay = date === selectedDate;
                                const isTodayColumn = date === todayIso();

                                return (
                                    <div
                                        key={`column-${date}`}
                                        data-column-date={date}
                                        className={`relative border-l border-[var(--color-border)] ${
                                            isSelectedDay ? 'bg-[var(--color-surface-hover)]/50' : ''
                                        }`}
                                        onDragOver={(event) => {
                                            event.preventDefault();
                                            event.dataTransfer.dropEffect = "move";
                                            if (draggingAppointmentId) {
                                                updateDragPreview(
                                                    date,
                                                    getStartTimeFromColumnPosition(event)
                                                );
                                            }
                                        }}
                                        onDrop={(event) => {
                                            void handleDayDrop(event, date);
                                        }}
                                    >
                                        {/* Time slots */}
                                        {timeSlots.map((slotMinutes) => {
                                            const slotTime = minutesToTimeString(slotMinutes);
                                            const isHourMark = slotMinutes % 60 === 0;
                                            const hourIndex = Math.floor((slotMinutes - DAY_START_MINUTES) / 60);
                                            const isEvenHour = hourIndex % 2 === 0;

                                            return (
                                                <div
                                                    key={`slot-${date}-${slotTime}`}
                                                    role="button"
                                                    tabIndex={0}
                                                    onClick={() => handleSlotClick(date, slotTime)}
                                                    onDoubleClick={() => openAddAppointment(date, slotTime)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter' || e.key === ' ') {
                                                            e.preventDefault();
                                                            openAddAppointment(date, slotTime);
                                                        }
                                                    }}
                                                    onTouchStart={() => handleSlotLongPressStart(date, slotTime)}
                                                    onTouchMove={handleSlotLongPressEnd}
                                                    onTouchEnd={handleSlotLongPressEnd}
                                                    onTouchCancel={handleSlotLongPressEnd}
                                                    onDragOver={(event) => {
                                                        event.preventDefault();
                                                        event.dataTransfer.dropEffect = "move";
                                                        event.stopPropagation();
                                                        if (draggingAppointmentId) {
                                                            updateDragPreview(date, slotTime);
                                                        }
                                                    }}
                                                    onDrop={(event) => {
                                                        void handleSlotDrop(event, date, slotTime);
                                                    }}
                                                    className={`block w-full text-left transition-colors hover:bg-[var(--color-primary-light)]/30 cursor-pointer ${
                                                        isHourMark ? 'border-t grid-line-hour' : 'border-t grid-line-soft'
                                                    } ${isEvenHour ? 'hour-even' : 'hour-odd'}`}
                                                    style={{ height: SLOT_HEIGHT_PX }}
                                                    aria-label={`Double-click or hold to add appointment ${date} at ${formatAxisTime(slotMinutes)}`}
                                                />
                                            );
                                        })}

                                        {/* Current time indicator */}
                                        {isTodayColumn && currentTimePosition !== null && (
                                            <div
                                                className="current-time-line"
                                                style={{ top: currentTimePosition }}
                                            />
                                        )}

                                        {/* Appointments - only show if PT Appointments toggle is enabled */}
                                        <div className="pointer-events-none absolute inset-0">
                                            {enabledCalendars["pt-appointments"] !== false && dayAppointments.map((appointment) => {
                                                const displayDuration = getRenderedDuration(appointment);
                                                const startMinutes = getRenderedStartMinutes(appointment);
                                                const blockStart = Math.max(startMinutes, DAY_START_MINUTES);
                                                const blockEnd = Math.min(
                                                    startMinutes + displayDuration,
                                                    DAY_END_MINUTES
                                                );

                                                if (blockEnd <= blockStart) {
                                                    return null;
                                                }

                                                const topPx =
                                                    ((blockStart - DAY_START_MINUTES) / SLOT_MINUTES) *
                                                        SLOT_HEIGHT_PX +
                                                    1;
                                                const heightPx = Math.max(
                                                    SLOT_HEIGHT_PX - 2,
                                                    ((blockEnd - blockStart) / SLOT_MINUTES) *
                                                        SLOT_HEIGHT_PX -
                                                        2
                                                );
                                                const sameStartGroup =
                                                    groupedByStartTime[minutesToTimeString(startMinutes)] ?? [];
                                                const groupSize = Math.max(1, sameStartGroup.length);
                                                const groupIndex = Math.max(
                                                    0,
                                                    sameStartGroup.findIndex((apt) => apt.id === appointment.id)
                                                );
                                                // In day view, use full width for better readability
                                                const isDayView = viewMode === 'day';
                                                const widthPct = isDayView ? 100 : (100 / groupSize);
                                                const leftStyle = isDayView ? '4px' : `calc(${groupIndex * widthPct}% + 2px)`;
                                                const widthStyle = isDayView ? 'calc(100% - 8px)' : `calc(${widthPct}% - 4px)`;
                                                const isActiveMove =
                                                    moveAppointmentId === appointment.id ||
                                                    copyAppointmentId === appointment.id ||
                                                    draggingAppointmentId === appointment.id;
                                                const isActiveResize =
                                                    resizingAppointmentId === appointment.id;
                                                const patient = getPatient(appointment.patientId);
                                                const legInfo = legInfoByAppointmentId[appointment.id];
                                                const visitType = appointment.visitType;
                                                const showMilesRow = heightPx >= 46;
                                                const showPhoneRow = heightPx >= 58;
                                                const showAddressRow = heightPx >= 72;
                                                const showAlternateContactRows = heightPx >= 88;

                                                return (
                                                    <div
                                                        key={appointment.id}
                                                        draggable
                                                        onDragStart={(event) =>
                                                            handleAppointmentDragStart(event, appointment.id)
                                                        }
                                                        onDragEnd={handleAppointmentDragEnd}
                                                        onTouchStart={(event) =>
                                                            handleChipTouchStart(event, appointment.id)
                                                        }
                                                        onTouchEnd={handleChipTouchEnd}
                                                        onTouchCancel={handleChipTouchEnd}
                                                        onClick={(event) =>
                                                            handleAppointmentChipClick(event, appointment.id)
                                                        }
                                                        className={`pointer-events-auto absolute rounded-md overflow-hidden text-white text-xs cursor-grab active:cursor-grabbing group appointment-chip ${
                                                            isActiveMove || isActiveResize
                                                                ? 'ring-2 ring-[var(--color-primary)] ring-offset-1 shadow-lg !transform-none'
                                                                : ''
                                                        }`}
                                                        style={{
                                                            position: 'absolute',
                                                            top: topPx,
                                                            height: heightPx,
                                                            left: leftStyle,
                                                            width: widthStyle,
                                                            background: getVisitTypeGradient(visitType),
                                                            touchAction: 'auto',
                                                            opacity: draggingAppointmentId === appointment.id ? 0.4 : undefined,
                                                        }}
                                                        title={`${getPatientName(appointment.patientId)}${patient?.phone ? ` - ${patient.phone}` : ''}${patient?.address ? ` - ${patient.address}` : ''}`}
                                                    >
                                                        {/* Main content area - full width, draggable from anywhere */}
                                                        {/* Larger text and spacing in day view for better readability */}
                                                        <div
                                                            className={`absolute left-2 right-1.5 top-0 bottom-0 overflow-hidden leading-snug ${
                                                                isDayView ? 'text-[14px]' : 'text-[12px]'
                                                            }`}
                                                            style={{
                                                                display: 'flex',
                                                                flexDirection: 'column',
                                                                alignItems: 'flex-start',
                                                                gap: isDayView ? '4px' : '2px',
                                                                padding: isDayView ? '8px 4px 14px 4px' : '4px 0 12px 0',
                                                            }}
                                                        >
                                                            <div className={`font-semibold truncate leading-[1.2] w-full overflow-hidden drop-shadow-sm ${
                                                                isDayView ? 'text-[16px] min-h-[20px]' : 'text-[13px] min-h-[16px]'
                                                            }`}>
                                                                {getPatientName(appointment.patientId)}
                                                            </div>
                                                            {visitType && (
                                                                <div className={`opacity-95 truncate w-full overflow-hidden font-medium tracking-wide ${
                                                                    isDayView ? 'text-[14px] min-h-[17px]' : 'text-[12px] min-h-[14px]'
                                                                }`}>
                                                                    [{visitType}]
                                                                </div>
                                                            )}
                                                            <div className={`opacity-90 truncate w-full overflow-hidden ${
                                                                isDayView ? 'text-[14px] min-h-[17px]' : 'text-[12px] min-h-[14px]'
                                                            }`}>
                                                                {minutesToTimeString(startMinutes)} ({displayDuration}m)
                                                            </div>
                                                            {showMilesRow && legInfo?.miles != null && (
                                                                <div className={`inline-flex items-center gap-1 opacity-90 truncate max-w-full overflow-hidden ${
                                                                    isDayView ? 'text-[14px] min-h-[17px]' : 'text-[12px] min-h-[14px]'
                                                                }`}>
                                                                    <Car className={isDayView ? 'w-3.5 h-3.5 shrink-0' : 'w-2.5 h-2.5 shrink-0'} />
                                                                    <span className="truncate">
                                                                        {legInfo.miles.toFixed(1)} mi
                                                                        {legInfo.minutes != null && ` (${legInfo.minutes} min)`}
                                                                    </span>
                                                                </div>
                                                            )}
                                                            {showPhoneRow && patient?.phone && (
                                                                <div className={`inline-flex w-fit max-w-full items-center gap-1 overflow-hidden whitespace-nowrap text-ellipsis opacity-90 ${
                                                                    isDayView ? 'text-[14px] min-h-[17px]' : 'text-[12px] min-h-[14px]'
                                                                }`}>
                                                                    <Phone className={isDayView ? 'w-3.5 h-3.5 shrink-0' : 'w-2.5 h-2.5 shrink-0'} />
                                                                    <span className="truncate">{patient.phone}</span>
                                                                </div>
                                                            )}
                                                            {showAddressRow && patient?.address && (
                                                                <div className={`inline-flex w-fit max-w-full items-center gap-1 overflow-hidden whitespace-nowrap text-ellipsis opacity-90 ${
                                                                    isDayView ? 'text-[14px] min-h-[17px]' : 'text-[12px] min-h-[14px]'
                                                                }`}>
                                                                    <MapPin className={isDayView ? 'w-3.5 h-3.5 shrink-0' : 'w-2.5 h-2.5 shrink-0'} />
                                                                    <span className="truncate">{patient.address.split(',')[0]}</span>
                                                                </div>
                                                            )}
                                                            {showAlternateContactRows && patient?.alternateContacts?.map((contact, idx) => (
                                                                <div
                                                                    key={idx}
                                                                    className={`inline-flex w-fit max-w-full items-center gap-1 overflow-hidden whitespace-nowrap text-ellipsis opacity-85 ${
                                                                        isDayView ? 'text-[14px] min-h-[17px]' : 'text-[12px] min-h-[14px]'
                                                                    }`}
                                                                >
                                                                    <Phone className={isDayView ? 'w-3.5 h-3.5 shrink-0' : 'w-2.5 h-2.5 shrink-0'} />
                                                                    <span className="truncate">{contact.firstName ? `${contact.firstName}: ` : ''}{contact.phone}</span>
                                                                </div>
                                                            ))}
                                                        </div>

                                                        {/* Invisible resize handles - larger in day view for easier grabbing */}
                                                        {/* Top resize handle */}
                                                        <div
                                                            onMouseDown={(event) => {
                                                                event.stopPropagation();
                                                                handleResizeStart(event as unknown as MouseEvent<HTMLButtonElement>, appointment, "top");
                                                            }}
                                                            onTouchStart={(event) => handleResizeTouchStart(event, appointment, "top")}
                                                            onTouchMove={handleResizeTouchEnd}
                                                            onTouchEnd={handleResizeTouchEnd}
                                                            onTouchCancel={handleResizeTouchEnd}
                                                            className={`absolute left-0 right-0 top-0 cursor-ns-resize pointer-events-auto ${isDayView ? 'h-8' : 'h-4'}`}
                                                            style={{ touchAction: 'auto' }}
                                                        />
                                                        {/* Bottom resize handle */}
                                                        <div
                                                            onMouseDown={(event) => {
                                                                event.stopPropagation();
                                                                handleResizeStart(event as unknown as MouseEvent<HTMLButtonElement>, appointment, "bottom");
                                                            }}
                                                            onTouchStart={(event) => handleResizeTouchStart(event, appointment, "bottom")}
                                                            onTouchMove={handleResizeTouchEnd}
                                                            onTouchEnd={handleResizeTouchEnd}
                                                            onTouchCancel={handleResizeTouchEnd}
                                                            className={`absolute left-0 right-0 bottom-0 cursor-ns-resize pointer-events-auto ${isDayView ? 'h-8' : 'h-4'}`}
                                                            style={{ touchAction: 'auto' }}
                                                        />

                                                    </div>
                                                );
                                            })}

                                            {/* External calendar events - only show events from enabled calendars */}
                                            {(externalEventsByDay[date] ?? [])
                                                .filter((event) => enabledCalendars[event.calendarId] !== false)
                                                .map((event) => {
                                                // Parse start/end times
                                                const startDate = new Date(event.startDateTime);
                                                const endDate = new Date(event.endDateTime);
                                                const startMinutes = startDate.getHours() * 60 + startDate.getMinutes();
                                                const endMinutes = endDate.getHours() * 60 + endDate.getMinutes();

                                                // Handle all-day events or events outside visible range
                                                const blockStart = Math.max(startMinutes, DAY_START_MINUTES);
                                                const blockEnd = Math.min(endMinutes || DAY_END_MINUTES, DAY_END_MINUTES);

                                                if (blockEnd <= blockStart) {
                                                    return null;
                                                }

                                                const topPx = ((blockStart - DAY_START_MINUTES) / SLOT_MINUTES) * SLOT_HEIGHT_PX + 1;
                                                const heightPx = Math.max(
                                                    SLOT_HEIGHT_PX - 2,
                                                    ((blockEnd - blockStart) / SLOT_MINUTES) * SLOT_HEIGHT_PX - 2
                                                );

                                                // Use calendar color or default
                                                const bgColor = event.backgroundColor || "#33b679";

                                                return (
                                                    <div
                                                        key={`ext-${event.id}`}
                                                        className="absolute rounded overflow-hidden text-white text-xs opacity-80"
                                                        style={{
                                                            top: topPx,
                                                            height: heightPx,
                                                            right: "2px",
                                                            width: "calc(40% - 2px)",
                                                            backgroundColor: bgColor,
                                                            borderLeft: `3px solid ${bgColor}`,
                                                            filter: "brightness(0.9)",
                                                        }}
                                                        title={`${event.summary}${event.location ? ` - ${event.location}` : ''}`}
                                                    >
                                                        <div className="p-1 h-full flex flex-col overflow-hidden">
                                                            <div className="font-medium truncate text-[10px]">
                                                                {event.summary}
                                                            </div>
                                                            {heightPx >= 32 && (
                                                                <div className="text-[9px] opacity-90 truncate">
                                                                    {startDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}

                                            {/* Drag preview */}
                                            {draggingAppointment &&
                                                dragPreview?.date === date &&
                                                (() => {
                                                    const previewDuration =
                                                        getRenderedDuration(draggingAppointment);
                                                    const previewStartMinutes =
                                                        timeStringToMinutes(dragPreview.startTime);
                                                    const previewBlockStart = Math.max(
                                                        previewStartMinutes,
                                                        DAY_START_MINUTES
                                                    );
                                                    const previewBlockEnd = Math.min(
                                                        previewStartMinutes + previewDuration,
                                                        DAY_END_MINUTES
                                                    );
                                                    if (previewBlockEnd <= previewBlockStart) {
                                                        return null;
                                                    }

                                                    const previewTopPx =
                                                        ((previewBlockStart - DAY_START_MINUTES) /
                                                            SLOT_MINUTES) *
                                                            SLOT_HEIGHT_PX +
                                                        1;
                                                    const previewHeightPx = Math.max(
                                                        SLOT_HEIGHT_PX - 2,
                                                        ((previewBlockEnd - previewBlockStart) /
                                                            SLOT_MINUTES) *
                                                            SLOT_HEIGHT_PX -
                                                            2
                                                    );

                                                    return (
                                                        <div
                                                            className="absolute rounded border-2 border-dashed border-[var(--color-primary)] bg-[var(--color-primary-light)]/50"
                                                            style={{
                                                                top: previewTopPx,
                                                                height: previewHeightPx,
                                                                left: "2px",
                                                                width: "calc(100% - 4px)",
                                                            }}
                                                        />
                                                    );
                                                })()}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            {/* Floating ghost chip during touch drag */}
            {touchDragGhost && (
                <div
                    className="fixed z-50 pointer-events-none rounded-md text-white text-xs shadow-2xl"
                    style={{
                        left: touchDragGhost.x - 60,
                        top: touchDragGhost.y - 20,
                        width: 120,
                        height: 40,
                        background: 'linear-gradient(135deg, #1a73e8 0%, #4285f4 100%)',
                        opacity: 0.9,
                    }}
                >
                    <div className="px-2 py-1 truncate font-semibold text-[11px]">
                        {touchDragGhost.name}
                    </div>
                    <div className="px-2 text-[10px] opacity-90">
                        {touchDragGhost.duration}m
                    </div>
                </div>
            )}

            {/* Day Map Modal */}
            {isDayMapOpen && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/35"
                    onClick={handleCloseDayMap}
                >
                    <div
                        className="bg-[var(--color-surface)] rounded-lg shadow-2xl w-full max-w-4xl mx-4 max-h-[90vh] overflow-hidden animate-slide-in"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
                            <div>
                                <h2 className="text-base font-medium text-[var(--color-text-primary)]">Day Map</h2>
                                <p className="text-xs text-[var(--color-text-secondary)]">{selectedDate}</p>
                            </div>
                            <button
                                onClick={handleCloseDayMap}
                                className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[var(--color-surface-hover)]"
                                aria-label="Close day map"
                            >
                                <X className="w-5 h-5 text-[var(--color-text-secondary)]" />
                            </button>
                        </div>

                        <div className="p-4 space-y-3">
                            {isDayMapLoading && (
                                <p className="text-sm text-[var(--color-text-secondary)]">Building map...</p>
                            )}

                            {dayMapError && (
                                <p className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded px-3 py-2">
                                    {dayMapError}
                                </p>
                            )}

                            {dayMapInfoMessage && (
                                <p className="text-sm text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded px-3 py-2">
                                    {dayMapInfoMessage}
                                </p>
                            )}

                            <div
                                ref={dayMapContainerRef}
                                className="w-full h-[52vh] min-h-[320px] rounded border border-[var(--color-border)]"
                            />
                        </div>

                        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--color-border)]">
                            <Button
                                variant="secondary"
                                onClick={() => {
                                    if (dayMapDirectionsHref) {
                                        window.open(dayMapDirectionsHref, "_blank");
                                    }
                                }}
                                disabled={!dayMapDirectionsHref || isDayMapLoading}
                            >
                                Open in Google Maps
                            </Button>
                            <Button variant="ghost" onClick={handleCloseDayMap}>
                                Close
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Add Appointment Modal */}
            {isAddOpen && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
                    onClick={cancelAddAppointment}
                >
                    <div
                        className="bg-[var(--color-surface)] rounded-lg shadow-2xl w-full max-w-md mx-4 animate-slide-in"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)]">
                            <h2 className="text-lg font-medium text-[var(--color-text-primary)]">New Appointment</h2>
                            <button
                                onClick={cancelAddAppointment}
                                className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[var(--color-surface-hover)]"
                            >
                                <X className="w-5 h-5 text-[var(--color-text-secondary)]" />
                            </button>
                        </div>

                        <div className="p-6 space-y-4">
                            {patients.length === 0 ? (
                                <p className="text-sm text-red-600 dark:text-red-400">
                                    Add a patient first before creating appointments.
                                </p>
                            ) : (
                                <>
                                    <div>
                                        <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                                            Patient
                                        </label>
                                        <select
                                            value={newPatientId}
                                            onChange={(e) => setNewPatientId(e.target.value)}
                                            className="w-full input-google"
                                        >
                                            {patients.map((patient) => (
                                                <option key={patient.id} value={patient.id}>
                                                    {patient.fullName}
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                                                Date
                                            </label>
                                            <input
                                                type="date"
                                                value={newAppointmentDate}
                                                onChange={(e) => setNewAppointmentDate(e.target.value)}
                                                className="w-full input-google"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                                                Start Time
                                            </label>
                                            <input
                                                type="time"
                                                step={SLOT_MINUTES * 60}
                                                value={newStartTime}
                                                onChange={(e) => setNewStartTime(e.target.value)}
                                                className="w-full input-google"
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                                            Duration (minutes)
                                        </label>
                                        <select
                                            value={newDuration}
                                            onChange={(e) => setNewDuration(Number(e.target.value))}
                                            className="w-full input-google"
                                        >
                                            {[15, 30, 45, 60, 90, 120].map((d) => (
                                                <option key={d} value={d}>
                                                    {d} minutes
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    <div>
                                        <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
                                            Visit Type
                                        </label>
                                        <div className="grid grid-cols-2 gap-2">
                                            {VISIT_TYPE_CONFIGS.map((config) => {
                                                const isSelected = newVisitType === config.code;
                                                return (
                                                    <button
                                                        key={config.code ?? "none"}
                                                        type="button"
                                                        onClick={() => setNewVisitType(config.code)}
                                                        className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-all ${
                                                            isSelected
                                                                ? "border-[var(--color-primary)] ring-2 ring-[var(--color-primary)]/20"
                                                                : "border-[var(--color-border)] hover:border-[var(--color-text-secondary)]"
                                                        }`}
                                                    >
                                                        <span
                                                            className="w-3 h-3 rounded-full shrink-0"
                                                            style={{ backgroundColor: config.bg }}
                                                        />
                                                        <span className="flex flex-col min-w-0">
                                                            <span className="text-xs font-medium text-[var(--color-text-primary)] truncate">
                                                                {config.code ?? "None"}
                                                            </span>
                                                            <span className="text-[10px] text-[var(--color-text-secondary)] truncate">
                                                                {config.label}
                                                            </span>
                                                        </span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {addError && (
                                        <p className="text-sm text-red-600 dark:text-red-400">{addError}</p>
                                    )}
                                </>
                            )}
                        </div>

                        <div className="flex justify-end gap-2 px-6 py-4 border-t border-[var(--color-border)]">
                            <Button variant="ghost" onClick={cancelAddAppointment} disabled={isSaving}>
                                Cancel
                            </Button>
                            <Button
                                variant="primary"
                                onClick={() => void handleCreateAppointment()}
                                disabled={isSaving || patients.length === 0}
                            >
                                {isSaving ? "Saving..." : "Save"}
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Floating Action Button */}
            <button
                onClick={() => openAddAppointment()}
                disabled={patients.length === 0}
                className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-[var(--color-primary)] text-white shadow-lg hover:shadow-xl hover:bg-[var(--color-primary-hover)] transition-all flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Add appointment"
            >
                <Plus className="w-6 h-6" />
            </button>

            {/* Error toast */}
            {autoArrangeError && (
                <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-gray-800 dark:bg-gray-700 text-white px-4 py-3 rounded shadow-lg text-sm">
                    {autoArrangeError}
                </div>
            )}

            {/* Maps Choice Menu */}
            {mapsMenuAddress && (
                <div
                    className="fixed inset-0 z-50 flex items-end justify-center bg-black/30"
                    onClick={() => setMapsMenuAddress(null)}
                >
                    <div
                        className="bg-[var(--color-surface)] rounded-t-xl shadow-2xl w-full max-w-md mx-4 mb-0 animate-slide-in safe-area-pb"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="p-4 border-b border-[var(--color-border)]">
                            <h3 className="text-center text-sm font-medium text-[var(--color-text-secondary)]">
                                Open in Maps
                            </h3>
                        </div>
                        <div className="p-2">
                            <button
                                onClick={() => {
                                    window.open(buildAppleMapsHref(mapsMenuAddress)!, '_blank');
                                    setMapsMenuAddress(null);
                                }}
                                className="w-full py-3 px-4 text-left text-[var(--color-primary)] hover:bg-[var(--color-surface-hover)] rounded-lg font-medium"
                            >
                                Apple Maps
                            </button>
                            <button
                                onClick={() => {
                                    window.open(buildGoogleMapsHref(mapsMenuAddress)!, '_blank');
                                    setMapsMenuAddress(null);
                                }}
                                className="w-full py-3 px-4 text-left text-[var(--color-primary)] hover:bg-[var(--color-surface-hover)] rounded-lg font-medium"
                            >
                                Google Maps
                            </button>
                        </div>
                        <div className="p-2 border-t border-[var(--color-border)]">
                            <button
                                onClick={() => setMapsMenuAddress(null)}
                                className="w-full py-3 px-4 text-center text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] rounded-lg font-medium"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Appointment Action Sheet */}
            {actionSheetAppointmentId && (() => {
                const actionAppointment = appointments.find((apt) => apt.id === actionSheetAppointmentId);
                const actionPatient = actionAppointment ? patientById.get(actionAppointment.patientId) : undefined;

                if (!actionAppointment) {
                    return null;
                }

                return (
                    <AppointmentActionSheet
                        appointment={actionAppointment}
                        patient={actionPatient}
                        isOpen={true}
                        onClose={() => setActionSheetAppointmentId(null)}
                        onNavigate={() => {
                            if (actionPatient?.address) {
                                if (isIOS()) {
                                    // Use location.href so iOS intercepts and opens Maps app
                                    // without creating a blank in-app browser overlay
                                    window.location.href = buildAppleMapsHref(actionPatient.address)!;
                                } else {
                                    window.open(buildGoogleMapsHref(actionPatient.address)!, '_blank');
                                }
                            }
                        }}
                        onViewEdit={() => {
                            setDetailAppointmentId(actionSheetAppointmentId);
                        }}
                        onMove={() => {
                            setMoveAppointmentId(actionSheetAppointmentId);
                        }}
                        onCopy={() => {
                            setCopyAppointmentId(actionSheetAppointmentId);
                        }}
                        onDelete={() => {
                            void handleDeleteAppointment(actionAppointment);
                        }}
                    />
                );
            })()}

            {/* Appointment Detail Modal */}
            {detailAppointmentId && (() => {
                const detailAppointment = appointments.find((apt) => apt.id === detailAppointmentId);
                const detailPatient = detailAppointment ? patientById.get(detailAppointment.patientId) : undefined;

                if (!detailAppointment) {
                    return null;
                }

                return (
                    <AppointmentDetailModal
                        appointment={detailAppointment}
                        patient={detailPatient}
                        isOpen={true}
                        onClose={() => setDetailAppointmentId(null)}
                        onSavePatient={async (patientId, changes) => {
                            await updatePatient(patientId, changes);
                        }}
                        onSaveAppointment={async (appointmentId, changes) => {
                            await update(appointmentId, changes);
                            triggerSync();
                        }}
                        onSyncToSheet={async (updatedPatient) => {
                            // Get spreadsheet ID from sync store
                            const { spreadsheetId } = useSyncStore.getState();
                            if (spreadsheetId && isSignedIn()) {
                                await syncPatientToSheetByStatus(spreadsheetId, updatedPatient);
                            }
                        }}
                    />
                );
            })()}
        </div>
    );
}
