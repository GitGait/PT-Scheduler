import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type DragEvent,
    type MouseEvent,
} from "react";
import { useAppointmentStore, usePatientStore } from "../stores";
import { Card, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { geocodeAddress } from "../api/geocode";
import { optimizeRoute } from "../api/optimize";
import type { Appointment, Patient } from "../types";
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
const DAY_START_MINUTES = 6 * 60;
const DAY_END_MINUTES = 20 * 60;
const SLOT_HEIGHT_PX = 48;
const MIN_DURATION_MINUTES = 15;
const EARTH_RADIUS_MILES = 3958.8;
const AVERAGE_DRIVE_SPEED_MPH = 30;
const HOME_BASE_ADDRESS = "2580 South Velvet Falls Way, Meridian, Boise, ID";
const HOME_BASE_FALLBACK_COORDINATES = { lat: 43.5813465, lng: -116.3774964 };
const APPOINTMENTS_SYNCED_EVENT = "pt-scheduler:appointments-synced";

const toIsoDate = (date: Date): string => date.toISOString().split("T")[0];

const parseIsoDate = (date: string): Date => new Date(`${date}T12:00:00`);

const todayIso = (): string => toIsoDate(new Date());

const getWeekDates = (selectedDate: string): string[] => {
    const start = parseIsoDate(selectedDate);
    start.setDate(start.getDate() - start.getDay());

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

function orderByNearestNeighbor<T extends { lat: number; lng: number }>(
    items: T[],
    start: { lat: number; lng: number }
): T[] {
    const remaining = [...items];
    const ordered: T[] = [];
    let current = start;

    while (remaining.length > 0) {
        let nearestIndex = 0;
        let nearestMiles = Number.POSITIVE_INFINITY;

        for (let index = 0; index < remaining.length; index += 1) {
            const miles = calculateMilesBetweenCoordinates(current, remaining[index]);
            if (miles < nearestMiles) {
                nearestMiles = miles;
                nearestIndex = index;
            }
        }

        const [nearest] = remaining.splice(nearestIndex, 1);
        ordered.push(nearest);
        current = nearest;
    }

    return ordered;
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

const buildMapsHref = (rawAddress?: string): string | null => {
    if (!rawAddress) {
        return null;
    }

    const trimmed = rawAddress.trim();
    if (!trimmed) {
        return null;
    }

    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(trimmed)}`;
};

interface SchedulePageProps {
    sidebarOpen?: boolean;
}

export function SchedulePage({ sidebarOpen = true }: SchedulePageProps) {
    const [selectedDate, setSelectedDate] = useState(todayIso);
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [newPatientId, setNewPatientId] = useState("");
    const [newAppointmentDate, setNewAppointmentDate] = useState(todayIso);
    const [newStartTime, setNewStartTime] = useState("09:00");
    const [newDuration, setNewDuration] = useState(60);
    const [addError, setAddError] = useState<string | null>(null);
    const [autoArrangeError, setAutoArrangeError] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [autoArrangeInProgressByDay, setAutoArrangeInProgressByDay] = useState<
        Record<string, boolean>
    >({});
    const [draggingAppointmentId, setDraggingAppointmentId] = useState<string | null>(null);
    const [dragPreview, setDragPreview] = useState<{ date: string; startTime: string } | null>(null);
    const [moveAppointmentId, setMoveAppointmentId] = useState<string | null>(null);
    const [resizingAppointmentId, setResizingAppointmentId] = useState<string | null>(null);
    const [draftRenderById, setDraftRenderById] = useState<
        Record<string, { startMinutes: number; duration: number }>
    >({});
    const suppressNextSlotClickRef = useRef(false);
    const suppressClickTimerRef = useRef<number | null>(null);
    const resizeSessionRef = useRef<{
        appointmentId: string;
        startY: number;
        edge: "top" | "bottom";
        initialStartMinutes: number;
        initialDuration: number;
        initialEndMinutes: number;
    } | null>(null);
    const resizeDraftRef = useRef<{ startMinutes: number; duration: number } | null>(null);
    const [homeCoordinates, setHomeCoordinates] = useState<{ lat: number; lng: number } | null>(
        HOME_BASE_FALLBACK_COORDINATES
    );
    const [resolvedPatientCoordinates, setResolvedPatientCoordinates] = useState<
        Record<string, { lat: number; lng: number }>
    >({});
    const patientGeocodeInFlightRef = useRef(new Set<string>());

    const { patients, loadAll } = usePatientStore();
    const { appointments, loading, loadByRange, markComplete, create, update, delete: deleteAppointment } =
        useAppointmentStore();

    const weekDates = useMemo(() => getWeekDates(selectedDate), [selectedDate]);
    const weekStart = weekDates[0];
    const weekEnd = weekDates[6];

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
            try {
                const geocoded = await geocodeAddress(HOME_BASE_ADDRESS);
                if (!cancelled) {
                    const hasValidCoordinates =
                        Number.isFinite(geocoded.lat) && Number.isFinite(geocoded.lng);
                    setHomeCoordinates(
                        hasValidCoordinates
                            ? { lat: geocoded.lat, lng: geocoded.lng }
                            : HOME_BASE_FALLBACK_COORDINATES
                    );
                }
            } catch {
                if (!cancelled) {
                    setHomeCoordinates(HOME_BASE_FALLBACK_COORDINATES);
                }
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

    // Get month/year display
    const monthYearDisplay = parseIsoDate(selectedDate).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
    });

    const navigateWeek = (weeks: number) => {
        const date = parseIsoDate(selectedDate);
        date.setDate(date.getDate() + weeks * 7);
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
            { miles: number | null; minutes: number | null; fromHome: boolean }
        > = {};

        for (const date of Object.keys(appointmentsByDay)) {
            const dayAppointments = appointmentsByDay[date];
            let previousCoords: { lat: number; lng: number } | null = homeCoordinates;

            for (let index = 0; index < dayAppointments.length; index += 1) {
                const appointment = dayAppointments[index];
                const isFirstOfDay = index === 0;
                const currentCoords = getPatientCoordinates(appointment.patientId);
                if (!currentCoords) {
                    infoById[appointment.id] = {
                        miles: null,
                        minutes: null,
                        fromHome: isFirstOfDay,
                    };
                    continue;
                }

                if (!previousCoords) {
                    infoById[appointment.id] = {
                        miles: null,
                        minutes: null,
                        fromHome: isFirstOfDay,
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
                };
                previousCoords = currentCoords;
            }
        }

        return infoById;
    }, [appointmentsByDay, homeCoordinates, patientById, resolvedPatientCoordinates]);

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

    const getPatientName = (patientId: string) => {
        const patient = getPatient(patientId);
        return patient?.fullName ?? "Unknown Patient";
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
                status: "scheduled",
                syncStatus: "local",
                notes: undefined,
            });
            setSelectedDate(newAppointmentDate);
            setIsAddOpen(false);
            setNewStartTime("09:00");
            setNewDuration(60);
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
        event.dataTransfer.setData("text/plain", appointmentId);
        event.dataTransfer.effectAllowed = "move";
        setDraggingAppointmentId(appointmentId);
        setMoveAppointmentId(appointmentId);
        const existing = appointments.find((apt) => apt.id === appointmentId);
        if (existing) {
            setDragPreview({ date: existing.date, startTime: existing.startTime });
        }
    };

    const handleAppointmentDragEnd = () => {
        setDraggingAppointmentId(null);
        setDragPreview(null);
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
        const slotIndex = Math.max(
            0,
            Math.min(timeSlots.length - 1, Math.floor(y / SLOT_HEIGHT_PX))
        );
        return minutesToTimeString(DAY_START_MINUTES + slotIndex * SLOT_MINUTES);
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

        void update(appointmentId, {
            date,
            startTime,
        });
    };

    const handleDayDrop = (
        event: DragEvent<HTMLDivElement>,
        date: string
    ) => {
        event.preventDefault();
        const droppedId = event.dataTransfer.getData("text/plain") || draggingAppointmentId;
        setDraggingAppointmentId(null);
        setDragPreview(null);

        if (!droppedId) {
            return;
        }

        const startTime = getStartTimeFromColumnPosition(event);

        moveAppointmentToSlot(droppedId, date, startTime);
        setMoveAppointmentId(null);
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
        suppressNextSlotClickRef.current = true;
        if (suppressClickTimerRef.current) {
            window.clearTimeout(suppressClickTimerRef.current);
        }
        suppressClickTimerRef.current = window.setTimeout(() => {
            suppressNextSlotClickRef.current = false;
        }, 0);
    };

    const handleAppointmentChipClick = (
        event: MouseEvent<HTMLDivElement>,
        appointmentId: string
    ) => {
        event.stopPropagation();
        setMoveAppointmentId((current) => (current === appointmentId ? null : appointmentId));
    };

    const handleSlotClick = (date: string, startTime: string) => {
        if (suppressNextSlotClickRef.current) {
            return;
        }

        if (moveAppointmentId) {
            void moveAppointmentToSlot(moveAppointmentId, date, startTime);
            setMoveAppointmentId(null);
            return;
        }

        openAddAppointment(date, startTime);
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
    };

    const handleAutoArrangeDay = async (date: string) => {
        const dayAppointments = (appointmentsByDay[date] ?? [])
            .slice()
            .sort((a, b) => a.startTime.localeCompare(b.startTime));

        if (dayAppointments.length < 2) {
            return;
        }

        setAutoArrangeError(null);
        setAutoArrangeInProgressByDay((current) => ({
            ...current,
            [date]: true,
        }));

        try {
            const dayStartMinutes = Math.max(
                DAY_START_MINUTES,
                Math.min(...dayAppointments.map((appointment) => timeStringToMinutes(appointment.startTime)))
            );

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

            let optimizedWithCoordinates = withCoordinates;
            if (withCoordinates.length >= 2) {
                try {
                    const routeResult = await optimizeRoute(
                        withCoordinates.map((item) => ({
                            id: item.appointment.id,
                            lat: item.lat,
                            lng: item.lng,
                        })),
                        homeCoordinates ?? HOME_BASE_FALLBACK_COORDINATES
                    );

                    const optimizedOrderById = new Map<string, number>(
                        routeResult.optimizedOrder.map((stop, index) => [stop.locationId, index])
                    );

                    optimizedWithCoordinates = [...withCoordinates].sort(
                        (a, b) =>
                            (optimizedOrderById.get(a.appointment.id) ?? Number.MAX_SAFE_INTEGER) -
                            (optimizedOrderById.get(b.appointment.id) ?? Number.MAX_SAFE_INTEGER)
                    );
                } catch {
                    optimizedWithCoordinates = orderByNearestNeighbor(
                        withCoordinates,
                        homeCoordinates ?? HOME_BASE_FALLBACK_COORDINATES
                    );
                }
            }

            const orderedAppointments = [
                ...optimizedWithCoordinates.map((item) => item.appointment),
                ...withoutCoordinates,
            ];

            let nextStartMinutes = dayStartMinutes;
            for (const appointment of orderedAppointments) {
                const snappedStartMinutes = Math.max(
                    DAY_START_MINUTES,
                    Math.round(nextStartMinutes / SLOT_MINUTES) * SLOT_MINUTES
                );
                const nextStartTime = minutesToTimeString(snappedStartMinutes);

                if (appointment.date !== date || appointment.startTime !== nextStartTime) {
                    await update(appointment.id, {
                        date,
                        startTime: nextStartTime,
                    });
                }

                nextStartMinutes = snappedStartMinutes + appointment.duration;
            }

            setSelectedDate(date);
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

    const getRenderedStartMinutes = (appointment: Appointment): number => {
        return draftRenderById[appointment.id]?.startMinutes ?? timeStringToMinutes(appointment.startTime);
    };

    const getRenderedDuration = (appointment: Appointment): number => {
        return draftRenderById[appointment.id]?.duration ?? appointment.duration;
    };

    const handleResizeStart = (
        event: MouseEvent<HTMLButtonElement>,
        appointment: Appointment,
        edge: "top" | "bottom"
    ) => {
        event.stopPropagation();
        event.preventDefault();
        setMoveAppointmentId(null);
        setResizingAppointmentId(appointment.id);
        const initialStartMinutes = getRenderedStartMinutes(appointment);
        const initialDuration = getRenderedDuration(appointment);
        resizeSessionRef.current = {
            appointmentId: appointment.id,
            startY: event.clientY,
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

    useEffect(() => {
        const handleMouseMove = (event: globalThis.MouseEvent) => {
            const session = resizeSessionRef.current;
            if (!session) {
                return;
            }
            const deltaSlots = Math.round((event.clientY - session.startY) / SLOT_HEIGHT_PX);

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

        const handleMouseUp = () => {
            const session = resizeSessionRef.current;
            if (!session) {
                return;
            }

            const nextRender = resizeDraftRef.current ?? {
                startMinutes: session.initialStartMinutes,
                duration: session.initialDuration,
            };
            if (
                nextRender.startMinutes !== session.initialStartMinutes ||
                nextRender.duration !== session.initialDuration
            ) {
                void update(session.appointmentId, {
                    startTime: minutesToTimeString(nextRender.startMinutes),
                    duration: nextRender.duration,
                });
            }

            setDraftRenderById((current) => {
                const next = { ...current };
                delete next[session.appointmentId];
                return next;
            });
            setResizingAppointmentId(null);
            resizeSessionRef.current = null;
            resizeDraftRef.current = null;
        };

        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);
        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
        };
    }, [update]);

    useEffect(() => {
        return () => {
            if (suppressClickTimerRef.current) {
                window.clearTimeout(suppressClickTimerRef.current);
            }
        };
    }, []);

    // Current time line position
    const currentTimePosition = useMemo(() => {
        const now = new Date();
        const currentMinutes = now.getHours() * 60 + now.getMinutes();
        if (currentMinutes < DAY_START_MINUTES || currentMinutes > DAY_END_MINUTES) {
            return null;
        }
        return ((currentMinutes - DAY_START_MINUTES) / SLOT_MINUTES) * SLOT_HEIGHT_PX;
    }, []);

    // Check if today is in the current week view
    const todayInWeek = weekDates.includes(todayIso());

    return (
        <div className="h-full flex flex-col bg-white">
            {/* Header with navigation */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-[#dadce0]">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => setSelectedDate(todayIso())}
                        className="px-4 h-9 border border-[#dadce0] rounded text-sm font-medium text-[#3c4043] hover:bg-[#f1f3f4] transition-colors"
                    >
                        Today
                    </button>
                    <div className="flex items-center">
                        <button
                            onClick={() => navigateWeek(-1)}
                            className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[#f1f3f4] transition-colors"
                            aria-label="Previous week"
                        >
                            <ChevronLeft className="w-5 h-5 text-[#5f6368]" />
                        </button>
                        <button
                            onClick={() => navigateWeek(1)}
                            className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[#f1f3f4] transition-colors"
                            aria-label="Next week"
                        >
                            <ChevronRight className="w-5 h-5 text-[#5f6368]" />
                        </button>
                    </div>
                    <h1 className="text-[22px] font-normal text-[#3c4043]">{monthYearDisplay}</h1>
                </div>

                <div className="flex items-center gap-2">
                    <button className="flex items-center gap-2 px-3 h-9 border border-[#dadce0] rounded text-sm font-medium text-[#3c4043] hover:bg-[#f1f3f4] transition-colors">
                        <span>Week</span>
                        <ChevronDown className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Info banner when moving */}
            {selectedMoveAppointment && (
                <div className="px-4 py-2 bg-[#e8f0fe] border-b border-[#dadce0]">
                    <p className="text-sm text-[#1a73e8]">
                        Moving {getPatientName(selectedMoveAppointment.patientId)}. Click a time slot to place it.
                    </p>
                </div>
            )}

            {/* Main grid area */}
            <div className="flex-1 overflow-auto">
                {loading ? (
                    <div className="h-full flex items-center justify-center">
                        <p className="text-[#5f6368]">Loading appointments...</p>
                    </div>
                ) : (
                    <div className="min-w-[900px]">
                        {/* Day headers */}
                        <div className="sticky top-0 z-20 bg-white border-b border-[#dadce0]">
                            <div className="grid grid-cols-[60px_repeat(7,1fr)]">
                                {/* GMT offset */}
                                <div className="py-2 px-1 text-right">
                                    <span className="text-[10px] text-[#70757a]">GMT-07</span>
                                </div>

                                {/* Day headers */}
                                {weekDates.map((date) => {
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
                                            className="flex flex-col items-center py-2 border-l border-[#dadce0]"
                                        >
                                            <span className={`text-xs font-medium ${isToday ? 'text-[#1a73e8]' : 'text-[#70757a]'}`}>
                                                {dayLabel}
                                            </span>
                                            <button
                                                onClick={() => setSelectedDate(date)}
                                                className={`mt-1 w-11 h-11 flex items-center justify-center rounded-full text-2xl transition-colors ${
                                                    isToday
                                                        ? 'bg-[#1a73e8] text-white'
                                                        : isSelected
                                                        ? 'bg-[#e8f0fe] text-[#1a73e8]'
                                                        : 'text-[#3c4043] hover:bg-[#f1f3f4]'
                                                }`}
                                            >
                                                {dayNumber}
                                            </button>
                                            {dayCount >= 2 && (
                                                <button
                                                    onClick={() => void handleAutoArrangeDay(date)}
                                                    disabled={isAutoArranging}
                                                    className="mt-1 text-[10px] text-[#1a73e8] hover:underline disabled:opacity-50"
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
                        <div className="grid grid-cols-[60px_repeat(7,1fr)]">
                            {/* Time axis */}
                            <div className="border-r border-[#dadce0]">
                                {timeSlots.map((slotMinutes, slotIndex) => (
                                    <div
                                        key={`axis-${slotMinutes}`}
                                        className="relative pr-2 text-right"
                                        style={{ height: SLOT_HEIGHT_PX }}
                                    >
                                        {slotIndex % 4 === 0 && (
                                            <span className="absolute -top-2 right-2 text-[10px] text-[#70757a]">
                                                {formatAxisTime(slotMinutes)}
                                            </span>
                                        )}
                                    </div>
                                ))}
                            </div>

                            {/* Day columns */}
                            {weekDates.map((date) => {
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
                                        className={`relative border-l border-[#dadce0] ${
                                            isSelectedDay ? 'bg-[#f8f9fa]' : ''
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

                                            return (
                                                <button
                                                    key={`slot-${date}-${slotTime}`}
                                                    onClick={() => handleSlotClick(date, slotTime)}
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
                                                    className={`block w-full text-left transition-colors hover:bg-[#f1f3f4] ${
                                                        isHourMark ? 'border-t border-[#dadce0]' : 'border-t border-[#f1f3f4]'
                                                    }`}
                                                    style={{ height: SLOT_HEIGHT_PX }}
                                                    aria-label={`Add appointment ${date} at ${formatAxisTime(slotMinutes)}`}
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

                                        {/* Appointments */}
                                        <div className="pointer-events-none absolute inset-0">
                                            {dayAppointments.map((appointment) => {
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
                                                const widthPct = 100 / groupSize;
                                                const leftStyle = `calc(${groupIndex * widthPct}% + 2px)`;
                                                const widthStyle = `calc(${widthPct}% - 4px)`;
                                                const isActiveMove =
                                                    moveAppointmentId === appointment.id ||
                                                    draggingAppointmentId === appointment.id;
                                                const isActiveResize =
                                                    resizingAppointmentId === appointment.id;
                                                const patient = getPatient(appointment.patientId);
                                                const legInfo = legInfoByAppointmentId[appointment.id];

                                                return (
                                                    <div
                                                        key={appointment.id}
                                                        draggable
                                                        onDragStart={(event) =>
                                                            handleAppointmentDragStart(event, appointment.id)
                                                        }
                                                        onDragEnd={handleAppointmentDragEnd}
                                                        onClick={(event) =>
                                                            handleAppointmentChipClick(event, appointment.id)
                                                        }
                                                        className={`pointer-events-auto absolute rounded overflow-hidden text-white text-xs cursor-grab active:cursor-grabbing transition-shadow group ${
                                                            isActiveMove || isActiveResize
                                                                ? 'ring-2 ring-[#1a73e8] ring-offset-1 shadow-lg'
                                                                : 'hover:shadow-md'
                                                        }`}
                                                        style={{
                                                            top: topPx,
                                                            height: heightPx,
                                                            left: leftStyle,
                                                            width: widthStyle,
                                                            backgroundColor: '#039be5',
                                                            borderLeft: '4px solid #0288d1',
                                                        }}
                                                        title={`${getPatientName(appointment.patientId)} - ${patient?.phone || 'No phone'}`}
                                                    >
                                                        <div className="p-1.5 h-full flex flex-col">
                                                            <div className="font-medium truncate">
                                                                {getPatientName(appointment.patientId)}
                                                            </div>
                                                            {heightPx >= 44 && (
                                                                <div className="text-[10px] opacity-90 truncate">
                                                                    {minutesToTimeString(startMinutes)} - {displayDuration}min
                                                                </div>
                                                            )}
                                                            {heightPx >= 60 && legInfo?.miles != null && (
                                                                <div className="text-[10px] opacity-80 truncate">
                                                                    {legInfo.fromHome ? 'Home' : 'Prev'}: {legInfo.miles.toFixed(1)}mi
                                                                </div>
                                                            )}
                                                        </div>

                                                        {/* Quick action buttons - visible on hover/focus */}
                                                        <div className="absolute bottom-1 left-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                                                            {buildPhoneHref(patient?.phone) && (
                                                                <a
                                                                    href={buildPhoneHref(patient?.phone)!}
                                                                    onClick={(e) => e.stopPropagation()}
                                                                    className="flex-1 flex items-center justify-center gap-1 py-1 bg-black/30 hover:bg-black/50 rounded text-[10px] transition-colors"
                                                                    aria-label={`Call ${patient?.fullName}`}
                                                                >
                                                                    <Phone className="w-3 h-3" />
                                                                    <span className="hidden sm:inline">Call</span>
                                                                </a>
                                                            )}
                                                            {buildMapsHref(patient?.address) && (
                                                                <a
                                                                    href={buildMapsHref(patient?.address)!}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    onClick={(e) => e.stopPropagation()}
                                                                    className="flex-1 flex items-center justify-center gap-1 py-1 bg-black/30 hover:bg-black/50 rounded text-[10px] transition-colors"
                                                                    aria-label={`Navigate to ${patient?.fullName}`}
                                                                >
                                                                    <Navigation className="w-3 h-3" />
                                                                    <span className="hidden sm:inline">Nav</span>
                                                                </a>
                                                            )}
                                                        </div>

                                                        {/* Delete button */}
                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                void handleDeleteAppointment(appointment);
                                                            }}
                                                            className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/20 flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                                                        >
                                                            <X className="w-3 h-3" />
                                                        </button>

                                                        {/* Resize handles */}
                                                        <button
                                                            type="button"
                                                            onMouseDown={(event) =>
                                                                handleResizeStart(event, appointment, "top")
                                                            }
                                                            onClick={(event) => event.stopPropagation()}
                                                            className="absolute left-0 right-0 top-0 h-2 cursor-ns-resize"
                                                        />
                                                        <button
                                                            type="button"
                                                            onMouseDown={(event) =>
                                                                handleResizeStart(event, appointment, "bottom")
                                                            }
                                                            onClick={(event) => event.stopPropagation()}
                                                            className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize"
                                                        />
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
                                                            className="absolute rounded border-2 border-dashed border-[#1a73e8] bg-[#e8f0fe]/50"
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

            {/* Add Appointment Modal */}
            {isAddOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
                    <div className="bg-white rounded-lg shadow-2xl w-full max-w-md mx-4 animate-slide-in">
                        <div className="flex items-center justify-between px-6 py-4 border-b border-[#dadce0]">
                            <h2 className="text-lg font-medium text-[#202124]">New Appointment</h2>
                            <button
                                onClick={cancelAddAppointment}
                                className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[#f1f3f4]"
                            >
                                <X className="w-5 h-5 text-[#5f6368]" />
                            </button>
                        </div>

                        <div className="p-6 space-y-4">
                            {patients.length === 0 ? (
                                <p className="text-sm text-[#d93025]">
                                    Add a patient first before creating appointments.
                                </p>
                            ) : (
                                <>
                                    <div>
                                        <label className="block text-sm font-medium text-[#5f6368] mb-1">
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
                                            <label className="block text-sm font-medium text-[#5f6368] mb-1">
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
                                            <label className="block text-sm font-medium text-[#5f6368] mb-1">
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
                                        <label className="block text-sm font-medium text-[#5f6368] mb-1">
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

                                    {addError && (
                                        <p className="text-sm text-[#d93025]">{addError}</p>
                                    )}
                                </>
                            )}
                        </div>

                        <div className="flex justify-end gap-2 px-6 py-4 border-t border-[#dadce0]">
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
                className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-[#1a73e8] text-white shadow-lg hover:shadow-xl hover:bg-[#1557b0] transition-all flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Add appointment"
            >
                <Plus className="w-6 h-6" />
            </button>

            {/* Error toast */}
            {autoArrangeError && (
                <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-[#323232] text-white px-4 py-3 rounded shadow-lg text-sm">
                    {autoArrangeError}
                </div>
            )}
        </div>
    );
}
