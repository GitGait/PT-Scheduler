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
import { useAppointmentStore, usePatientStore, useScheduleStore, useSyncStore, useDayNoteStore, type ExternalCalendarEvent } from "../stores";
import { fetchCalendarEvents } from "../api/calendar";
import { isSignedIn } from "../api/auth";
import { syncPatientToSheetByStatus } from "../api/sheets";
import { Card, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { ScheduleGridSkeleton } from "../components/ui/Skeleton";
import { AppointmentDetailModal } from "../components/AppointmentDetailModal";
import { AppointmentActionSheet } from "../components/AppointmentActionSheet";
import { DayNoteModal } from "../components/DayNoteModal";
import { SlotActionMenu } from "../components/SlotActionMenu";
import { DayNoteChip } from "../components/DayNoteChip";
import { AddAppointmentModal } from "../components/AddAppointmentModal";
import { DayMapModal } from "../components/DayMapModal";
import { useLocationData } from "../hooks/useLocationData";
import { useWeekActions } from "../hooks/useWeekActions";
import type { Appointment, Patient, VisitType } from "../types";
import { getVisitTypeGradient } from "../utils/visitTypeColors";
import { getChipNoteClasses } from "../utils/chipNoteColors";
import {
    PERSONAL_PATIENT_ID,
    isPersonalEvent,
    getPersonalCategoryGradient,
    getPersonalCategoryLabel,
} from "../utils/personalEventColors";
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
    Building2,
} from "lucide-react";

import {
    toLocalIsoDate,
    parseLocalDate,
    todayIso,
    timeStringToMinutes,
    minutesToTimeString,
    formatAxisTime,
    buildPhoneHref,
    buildGoogleMapsHref,
    buildAppleMapsHref,
    isIOS,
    getWeekDates,
    SLOT_MINUTES,
    DAY_START_MINUTES,
    DAY_END_MINUTES,
    SLOT_HEIGHT_PX,
    MIN_DURATION_MINUTES,
} from "../utils/scheduling";
const APPOINTMENTS_SYNCED_EVENT = "pt-scheduler:appointments-synced";
const DAY_NOTES_SYNCED_EVENT = "pt-scheduler:day-notes-synced";
const REQUEST_SYNC_EVENT = "pt-scheduler:request-sync";

const triggerSync = () => {
    window.dispatchEvent(new Event(REQUEST_SYNC_EVENT));
};


export function SchedulePage() {
    const {
        selectedDate,
        setSelectedDate,
        googleCalendars,
        enabledCalendars,
        externalEvents,
        setExternalEvents,
        pendingRestoreFromHoldId,
        setPendingRestoreFromHoldId,
    } = useScheduleStore();
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [addPrefillDate, setAddPrefillDate] = useState(selectedDate);
    const [addPrefillTime, setAddPrefillTime] = useState<string | undefined>();
    const [addPrefillIsPersonal, setAddPrefillIsPersonal] = useState(false);
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
    const dragCommittedRef = useRef(false);
    const dragPreviewRef = useRef<{ date: string; startTime: string } | null>(null);
    const draggingAppointmentIdRef = useRef<string | null>(null);
    const mutationCooldownRef = useRef(0);
    const [touchDragGhost, setTouchDragGhost] = useState<{ x: number; y: number; name: string; duration: number } | null>(null);

    const [detailAppointmentId, setDetailAppointmentId] = useState<string | null>(null);
    const [mapsMenuAddress, setMapsMenuAddress] = useState<string | null>(null);
    const [actionSheetAppointmentId, setActionSheetAppointmentId] = useState<string | null>(null);

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
    const [isDayMapOpen, setIsDayMapOpen] = useState(false);

    const { patients, loadAll, update: updatePatient } = usePatientStore();
    const { appointments, loading, loadByRange, markComplete, create, update, delete: deleteAppointment, loadOnHold, putOnHold } =
        useAppointmentStore();
    const { notes: dayNotes, loadByRange: loadDayNotes, create: createDayNote, update: updateDayNote, delete: deleteDayNote, moveNote } =
        useDayNoteStore();

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
        void loadOnHold();
        void loadDayNotes(weekStart, weekEnd);
    }, [loadByRange, loadOnHold, loadDayNotes, weekStart, weekEnd]);

    useEffect(() => {
        const handleAppointmentsSynced = () => {
            if (!weekStart || !weekEnd) {
                return;
            }
            // Don't reload during active drag/resize — the natural
            // triggerSync() after drop/resize-end will refresh data.
            if (
                touchDragRef.current?.activated ||
                draggingAppointmentIdRef.current ||
                resizeSessionRef.current ||
                Date.now() - mutationCooldownRef.current < 3000
            ) {
                return;
            }
            // Preserve scroll position when sync replaces appointments
            const scrollTop = zoomContainerRef.current?.scrollTop ?? 0;
            const scrollLeft = zoomContainerRef.current?.scrollLeft ?? 0;
            pendingScrollRestoreRef.current = { top: scrollTop, left: scrollLeft, rendersLeft: 10 };
            void loadByRange(weekStart, weekEnd);
            void loadOnHold();
            void loadDayNotes(weekStart, weekEnd);
        };

        const handleDayNotesSynced = () => {
            if (!weekStart || !weekEnd) {
                return;
            }
            void loadDayNotes(weekStart, weekEnd);
        };

        window.addEventListener(APPOINTMENTS_SYNCED_EVENT, handleAppointmentsSynced);
        window.addEventListener(DAY_NOTES_SYNCED_EVENT, handleDayNotesSynced);
        return () => {
            window.removeEventListener(APPOINTMENTS_SYNCED_EVENT, handleAppointmentsSynced);
            window.removeEventListener(DAY_NOTES_SYNCED_EVENT, handleDayNotesSynced);
        };
    }, [loadByRange, loadOnHold, loadDayNotes, weekStart, weekEnd]);

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
    const monthYearDisplay = parseLocalDate(selectedDate).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
    });

    const navigateWeek = (direction: number) => {
        const date = parseLocalDate(selectedDate);
        // Navigate by day in day view, by week in week view
        const daysToMove = viewMode === 'day' ? direction : direction * 7;
        date.setDate(date.getDate() + daysToMove);
        setSelectedDate(toLocalIsoDate(date));
    };

    const appointmentCountsByDay = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const apt of appointments) {
            if (apt.status === "on-hold") continue;
            counts[apt.date] = (counts[apt.date] ?? 0) + 1;
        }
        return counts;
    }, [appointments]);

    const selectedDayAppointments = useMemo(() => {
        return appointments
            .filter((apt) => apt.date === selectedDate && apt.status !== "on-hold")
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
            if (appointment.status === "on-hold") continue;
            if (grouped[appointment.date]) {
                grouped[appointment.date].push(appointment);
            }
        }

        for (const date of Object.keys(grouped)) {
            grouped[date].sort((a, b) => a.startTime.localeCompare(b.startTime));
        }

        return grouped;
    }, [appointments, weekDates]);

    // Group day notes by date
    const notesByDay = useMemo(() => {
        const grouped: Record<string, import("../types").DayNote[]> = {};
        for (const date of displayDates) {
            grouped[date] = [];
        }
        for (const note of dayNotes) {
            if (grouped[note.date]) {
                grouped[note.date].push(note);
            }
        }
        return grouped;
    }, [dayNotes, displayDates]);

    const [dayNoteDate, setDayNoteDate] = useState<string | null>(null);
    const [dayNotePrefillMinutes, setDayNotePrefillMinutes] = useState<number | undefined>(undefined);
    const [slotActionMenu, setSlotActionMenu] = useState<{ date: string; startTime: string; anchorRect: DOMRect } | null>(null);
    const [draggingNoteId, setDraggingNoteId] = useState<string | null>(null);
    const [noteDragPreview, setNoteDragPreview] = useState<{ date: string; startTime: string } | null>(null);

    // Touch drag refs for note dragging
    const touchDragNoteRef = useRef<{
        noteId: string;
        startX: number;
        startY: number;
        activated: boolean;
    } | null>(null);
    const touchDragNoteTimerRef = useRef<number | null>(null);
    const touchDragNoteGhostRef = useRef<{ x: number; y: number; text: string } | null>(null);
    const [touchDragNoteGhost, setTouchDragNoteGhost] = useState<{ x: number; y: number; text: string } | null>(null);

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

    const {
        homeCoordinates,
        resolvePatientCoordinatesForRouting,
        legInfoByAppointmentId,
        selectedDayEstimatedDriveMinutes,
    } = useLocationData(appointments, patientById, appointmentsByDay, selectedDayAppointments);

    const resetInteractionState = useCallback(() => {
        setMoveAppointmentId(null);
        setDraggingAppointmentId(null);
        setResizingAppointmentId(null);
        setDetailAppointmentId(null);
        setDraftRenderById({});
    }, []);

    const {
        lastClearedWeekSnapshot,
        weekActionInProgress,
        weekActionMessage,
        weekActionError,
        autoArrangeInProgressByDay,
        autoArrangeError,
        handleClearWeek,
        handleUndoClearWeek,
        handleAutoArrangeDay,
    } = useWeekActions(
        weekDates,
        appointmentsByDay,
        homeCoordinates,
        resolvePatientCoordinatesForRouting,
        resetInteractionState,
    );

    const getPatient = useCallback(
        (patientId: string) => patientById.get(patientId),
        [patientById]
    );

    const formatPatientDisplayName = (patient: Patient) => {
        const nickname = patient.nicknames.find((value) => value.trim().length > 0);
        if (!nickname) {
            return patient.fullName;
        }
        return `${patient.fullName} "${nickname.trim()}"`;
    };

    const getPatientName = (patientId: string, appointment?: Appointment) => {
        if (patientId === PERSONAL_PATIENT_ID && appointment) {
            return appointment.title || getPersonalCategoryLabel(appointment.personalCategory);
        }
        const patient = getPatient(patientId);
        if (!patient) {
            return "Unknown Patient";
        }
        return formatPatientDisplayName(patient);
    };

    const openAddAppointment = (prefillDate = selectedDate, prefillTime?: string) => {
        void loadAll();
        setSelectedDate(prefillDate);
        setAddPrefillDate(prefillDate);
        setAddPrefillTime(prefillTime);
        setAddPrefillIsPersonal(false);
        setIsAddOpen(true);
    };

    const openSlotMenu = (date: string, startTime: string, anchorEl: Element | null) => {
        if (!anchorEl) return;
        const rect = anchorEl.getBoundingClientRect();
        setSlotActionMenu({ date, startTime, anchorRect: rect });
    };

    const openNoteForSlot = (date: string, startMinutes: number) => {
        setDayNotePrefillMinutes(startMinutes);
        setDayNoteDate(date);
    };

    // Note drag handlers (HTML5 DnD)
    const handleNoteDragStart = (e: DragEvent<HTMLDivElement>, noteId: string) => {
        e.dataTransfer.setData("application/x-daynote", noteId);
        e.dataTransfer.effectAllowed = "move";
        setDraggingNoteId(noteId);
    };

    const handleNoteDragEnd = () => {
        setDraggingNoteId(null);
        setNoteDragPreview(null);
    };

    // Note touch drag
    const handleNoteTouchStart = (e: TouchEvent<HTMLDivElement>, noteId: string, noteText: string) => {
        if (resizeSessionRef.current || resizingAppointmentId) return;

        const touch = e.touches[0];
        touchDragNoteRef.current = {
            noteId,
            startX: touch.clientX,
            startY: touch.clientY,
            activated: false,
        };

        touchDragNoteTimerRef.current = window.setTimeout(() => {
            if (touchDragNoteRef.current && !touchDragNoteRef.current.activated) {
                const scrollTop = zoomContainerRef.current?.scrollTop ?? 0;
                const scrollLeft = zoomContainerRef.current?.scrollLeft ?? 0;
                pendingScrollRestoreRef.current = { top: scrollTop, left: scrollLeft, rendersLeft: 10 };

                touchDragNoteRef.current.activated = true;
                setDraggingNoteId(noteId);
                setTouchDragNoteGhost({ x: touch.clientX, y: touch.clientY, text: noteText });
                touchDragNoteGhostRef.current = { x: touch.clientX, y: touch.clientY, text: noteText };
            }
        }, TOUCH_DRAG_HOLD_MS);
    };

    const handleAppointmentDragStart = (
        event: DragEvent<HTMLDivElement>,
        appointmentId: string
    ) => {
        // Block HTML5 drag when touch drag is active
        if (touchDragRef.current) {
            event.preventDefault();
            return;
        }
        dragCommittedRef.current = false;
        draggingAppointmentIdRef.current = appointmentId;

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
            const preview = { date: existing.date, startTime: existing.startTime };
            setDragPreview(preview);
            dragPreviewRef.current = preview;
        }
    };

    const handleAppointmentDragEnd = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();

        // Fallback: if drop didn't fire but we have a valid preview, commit the move.
        // This fixes the browser quirk where HTML5 drop events intermittently fail to fire.
        // Uses ref instead of state to avoid stale closure when dragend fires before re-render.
        if (!dragCommittedRef.current && draggingAppointmentIdRef.current && dragPreviewRef.current) {
            const scrollTop = zoomContainerRef.current?.scrollTop ?? 0;
            const scrollLeft = zoomContainerRef.current?.scrollLeft ?? 0;
            pendingScrollRestoreRef.current = { top: scrollTop, left: scrollLeft, rendersLeft: 10 };
            void moveAppointmentToSlot(
                draggingAppointmentIdRef.current,
                dragPreviewRef.current.date,
                dragPreviewRef.current.startTime
            );
        }

        dragCommittedRef.current = false;
        dragPreviewRef.current = null;
        draggingAppointmentIdRef.current = null;
        setDraggingAppointmentId(null);
        setDragPreview(null);
        setMoveAppointmentId(null);
    };

    const updateDragPreview = (date: string, startTime: string) => {
        dragPreviewRef.current = { date, startTime };
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

    const moveAppointmentToSlot = async (appointmentId: string, date: string, startTime: string) => {
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

        // Inline scroll preservation so we can await the update
        const scrollTop = zoomContainerRef.current?.scrollTop ?? 0;
        const scrollLeft = zoomContainerRef.current?.scrollLeft ?? 0;
        pendingScrollRestoreRef.current = { top: scrollTop, left: scrollLeft, rendersLeft: 10 };

        await update(appointmentId, { date, startTime });
        triggerSync();
    };

    const copyAppointmentToSlot = async (appointmentId: string, date: string, startTime: string) => {
        const source = appointments.find((apt) => apt.id === appointmentId);
        if (!source) return;

        // Inline scroll preservation so we can await the create
        const scrollTop = zoomContainerRef.current?.scrollTop ?? 0;
        const scrollLeft = zoomContainerRef.current?.scrollLeft ?? 0;
        pendingScrollRestoreRef.current = { top: scrollTop, left: scrollLeft, rendersLeft: 10 };

        await create({
            patientId: source.patientId,
            date,
            startTime,
            duration: source.duration,
            visitType: source.visitType,
            personalCategory: source.personalCategory,
            title: source.title,
            notes: source.notes,
            chipNote: source.chipNote,
            chipNotes: source.chipNotes,
            chipNoteColor: source.chipNoteColor,
            status: 'scheduled',
        });
        triggerSync();
    };

    const handleDayDrop = (
        event: DragEvent<HTMLDivElement>,
        date: string
    ) => {
        event.preventDefault();

        // Check for day note drop
        const noteId = event.dataTransfer.getData("application/x-daynote");
        if (noteId) {
            const startTime = getStartTimeFromColumnPosition(event);
            const startMinutes = timeStringToMinutes(startTime);
            void moveNote(noteId, date, startMinutes);
            setDraggingNoteId(null);
            setNoteDragPreview(null);
            dragCommittedRef.current = true;
            return;
        }

        const droppedId = event.dataTransfer.getData("text/plain") || draggingAppointmentId;

        // Lock scroll before any state changes
        const scrollTop = zoomContainerRef.current?.scrollTop ?? 0;
        const scrollLeft = zoomContainerRef.current?.scrollLeft ?? 0;
        pendingScrollRestoreRef.current = { top: scrollTop, left: scrollLeft, rendersLeft: 10 };

        setDraggingAppointmentId(null);
        setDragPreview(null);

        if (!droppedId) {
            dragCommittedRef.current = true;
            return;
        }

        const startTime = getStartTimeFromColumnPosition(event);

        void moveAppointmentToSlot(droppedId, date, startTime);
        dragCommittedRef.current = true;
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
        event: DragEvent<HTMLDivElement>,
        date: string,
        startTime: string
    ) => {
        event.preventDefault();
        event.stopPropagation();

        // Check for day note drop first
        const noteId = event.dataTransfer.getData("application/x-daynote");
        if (noteId) {
            const startMinutes = timeStringToMinutes(startTime);
            void moveNote(noteId, date, startMinutes);
            setDraggingNoteId(null);
            setNoteDragPreview(null);
            dragCommittedRef.current = true;
            suppressNextSlotClickRef.current = true;
            if (suppressClickTimerRef.current) {
                window.clearTimeout(suppressClickTimerRef.current);
            }
            suppressClickTimerRef.current = window.setTimeout(() => {
                suppressNextSlotClickRef.current = false;
            }, 0);
            return;
        }

        const droppedId = event.dataTransfer.getData("text/plain") || draggingAppointmentId;
        setDraggingAppointmentId(null);
        setDragPreview(null);

        if (!droppedId) {
            dragCommittedRef.current = true;
            return;
        }

        void moveAppointmentToSlot(droppedId, date, startTime);
        dragCommittedRef.current = true;
        setMoveAppointmentId(null);
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
                const existing = useAppointmentStore.getState().appointments.find((a) => a.id === appointmentId);
                if (existing) {
                    const preview = { date: existing.date, startTime: existing.startTime };
                    setDragPreview(preview);
                    touchDragPreviewRef.current = preview;
                }
                // Show floating ghost at finger position
                if (touchDragRef.current && existing) {
                    let ghostName = 'Appointment';
                    if (isPersonalEvent(existing)) {
                        ghostName = existing.title || getPersonalCategoryLabel(existing.personalCategory);
                    } else {
                        const patient = usePatientStore.getState().patients.find((p) => p.id === existing.patientId);
                        ghostName = patient?.fullName ?? 'Appointment';
                    }
                    setTouchDragGhost({
                        x: touchDragRef.current.startX,
                        y: touchDragRef.current.startY,
                        name: ghostName,
                        duration: existing.duration,
                    });
                }
                if (navigator.vibrate) navigator.vibrate(30);
            }
        }, TOUCH_DRAG_HOLD_MS);
    };

    const handleChipTouchEnd = () => {
        const state = touchDragRef.current;
        const preview = touchDragPreviewRef.current;

        // Lock scroll position BEFORE any state changes
        if (state?.activated) {
            const scrollTop = zoomContainerRef.current?.scrollTop ?? 0;
            const scrollLeft = zoomContainerRef.current?.scrollLeft ?? 0;
            pendingScrollRestoreRef.current = { top: scrollTop, left: scrollLeft, rendersLeft: 10 };
        }

        // Clear timer and preview ref immediately
        if (touchDragTimerRef.current) {
            clearTimeout(touchDragTimerRef.current);
            touchDragTimerRef.current = null;
        }
        touchDragPreviewRef.current = null;
        setTouchDragGhost(null);

        if (state?.activated && preview) {
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

            // Set cooldown BEFORE starting async work
            mutationCooldownRef.current = Date.now();

            // Keep touchDragRef.current alive through the async move so
            // handleAppointmentsSynced guard stays active during the operation.
            void (async () => {
                await moveAppointmentToSlot(
                    state.appointmentId,
                    preview.date,
                    preview.startTime
                );
                // Clear guard source and drag visual state AFTER move completes
                touchDragRef.current = null;
                setDraggingAppointmentId(null);
                setDragPreview(null);
            })();
        } else {
            // Non-activated touch — clear everything immediately
            touchDragRef.current = null;
            setDraggingAppointmentId(null);
            setDragPreview(null);
        }
    };

    const handleNoteTouchEnd = () => {
        const state = touchDragNoteRef.current;

        if (state?.activated) {
            const scrollTop = zoomContainerRef.current?.scrollTop ?? 0;
            const scrollLeft = zoomContainerRef.current?.scrollLeft ?? 0;
            pendingScrollRestoreRef.current = { top: scrollTop, left: scrollLeft, rendersLeft: 10 };
        }

        if (state?.activated && noteDragPreview) {
            const startMinutes = timeStringToMinutes(noteDragPreview.startTime);
            void moveNote(state.noteId, noteDragPreview.date, startMinutes);
            suppressNextSlotClickRef.current = true;
            if (suppressClickTimerRef.current) window.clearTimeout(suppressClickTimerRef.current);
            suppressClickTimerRef.current = window.setTimeout(() => {
                suppressNextSlotClickRef.current = false;
            }, 400);
        }

        if (touchDragNoteTimerRef.current) {
            clearTimeout(touchDragNoteTimerRef.current);
            touchDragNoteTimerRef.current = null;
        }
        touchDragNoteRef.current = null;
        touchDragNoteGhostRef.current = null;
        setDraggingNoteId(null);
        setNoteDragPreview(null);
        setTouchDragNoteGhost(null);
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
            return;
        }
        // Handle copy mode - duplicating an appointment to a new slot
        if (copyAppointmentId) {
            void copyAppointmentToSlot(copyAppointmentId, date, startTime);
            setCopyAppointmentId(null);
            return;
        }
        // For adding new appointments, require long press (handled separately)
    };

    const LONG_PRESS_DURATION_MS = 400;

    const slotLongPressElRef = useRef<Element | null>(null);

    const handleSlotLongPressStart = (date: string, startTime: string, el: Element | null) => {
        // Don't start long press if we're in move or copy mode
        if (moveAppointmentId || copyAppointmentId) {
            return;
        }

        slotLongPressTargetRef.current = { date, startTime };
        slotLongPressElRef.current = el;
        if (slotLongPressTimerRef.current) {
            window.clearTimeout(slotLongPressTimerRef.current);
        }
        slotLongPressTimerRef.current = window.setTimeout(() => {
            if (slotLongPressTargetRef.current) {
                openSlotMenu(
                    slotLongPressTargetRef.current.date,
                    slotLongPressTargetRef.current.startTime,
                    slotLongPressElRef.current
                );
                slotLongPressTargetRef.current = null;
                slotLongPressElRef.current = null;
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
        const patientName = getPatientName(appointment.patientId, appointment);
        const confirmed = window.confirm(
            `Delete ${isPersonalEvent(appointment) ? '' : 'appointment for '}${patientName} on ${appointment.date} at ${appointment.startTime}?`
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

        mutationCooldownRef.current = Date.now();
        await deleteAppointment(appointment.id);
        triggerSync();
    };

    // Watch for restore-from-hold requests from the Sidebar (via schedule store)
    useEffect(() => {
        if (!pendingRestoreFromHoldId) return;
        // Enter move mode for the restored appointment
        setMoveAppointmentId(pendingRestoreFromHoldId);
        setPendingRestoreFromHoldId(null);
    }, [pendingRestoreFromHoldId, setPendingRestoreFromHoldId]);

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

        const computeSlotFromTouch = (touch: globalThis.Touch) => {
            const columnEl = findColumnAtPoint(touch.clientX, touch.clientY);
            if (!columnEl) return null;
            const date = columnEl.getAttribute('data-column-date');
            const rect = columnEl.getBoundingClientRect();
            const y = touch.clientY - rect.top;
            const scaledSlotHeight = SLOT_HEIGHT_PX * zoomScale;
            const slotIndex = Math.max(
                0,
                Math.min(timeSlots.length - 1, Math.floor(y / scaledSlotHeight))
            );
            const startTime = minutesToTimeString(DAY_START_MINUTES + slotIndex * SLOT_MINUTES);
            return date ? { date, startTime } : null;
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

            const slot = computeSlotFromTouch(touch);
            if (slot) {
                const preview = { date: slot.date, startTime: slot.startTime };
                touchDragPreviewRef.current = preview;
                setDragPreview((prev) => {
                    if (prev?.date === slot.date && prev.startTime === slot.startTime) return prev;
                    return preview;
                });
            }
        };

        // Note touch drag move
        const handleNoteTouchDragMove = (event: globalThis.TouchEvent) => {
            const state = touchDragNoteRef.current;
            if (!state) return;

            const touch = event.touches[0];

            if (!state.activated) {
                const dx = Math.abs(touch.clientX - state.startX);
                const dy = Math.abs(touch.clientY - state.startY);
                if (dx > 10 || dy > 10) {
                    if (touchDragNoteTimerRef.current) {
                        clearTimeout(touchDragNoteTimerRef.current);
                        touchDragNoteTimerRef.current = null;
                    }
                    touchDragNoteRef.current = null;
                }
                return;
            }

            event.preventDefault();

            setTouchDragNoteGhost((prev) => {
                if (!prev) return prev;
                if (prev.x === touch.clientX && prev.y === touch.clientY) return prev;
                return { ...prev, x: touch.clientX, y: touch.clientY };
            });
            if (touchDragNoteGhostRef.current) {
                touchDragNoteGhostRef.current = { ...touchDragNoteGhostRef.current, x: touch.clientX, y: touch.clientY };
            }

            const slot = computeSlotFromTouch(touch);
            if (slot) {
                setNoteDragPreview((prev) => {
                    if (prev?.date === slot.date && prev.startTime === slot.startTime) return prev;
                    return { date: slot.date, startTime: slot.startTime };
                });
            }
        };

        window.addEventListener('touchmove', handleTouchDragMove, { passive: false });
        window.addEventListener('touchmove', handleNoteTouchDragMove, { passive: false });
        return () => {
            window.removeEventListener('touchmove', handleTouchDragMove);
            window.removeEventListener('touchmove', handleNoteTouchDragMove);
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
            if (touchDragNoteTimerRef.current) {
                window.clearTimeout(touchDragNoteTimerRef.current);
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
                            aria-label={viewMode === 'day' ? 'Previous day' : 'Previous week'}
                        >
                            <ChevronLeft className="w-4 h-4 text-[var(--color-text-secondary)]" />
                        </button>
                        <div className="w-px h-4 bg-[var(--color-border)]" />
                        <button
                            onClick={() => navigateWeek(1)}
                            className="w-7 h-7 flex items-center justify-center rounded-r-md hover:bg-[var(--color-border)] active:bg-[var(--color-border)] transition-colors"
                            aria-label={viewMode === 'day' ? 'Next day' : 'Next week'}
                        >
                            <ChevronRight className="w-4 h-4 text-[var(--color-text-secondary)]" />
                        </button>
                    </div>
                    <h1 className="text-sm sm:text-base font-semibold text-[var(--color-text-primary)] ml-1">{monthYearDisplay}</h1>
                </div>

                <div className="relative flex items-center gap-1.5">
                    <button
                        onClick={() => setIsDayMapOpen(true)}
                        className="hidden sm:flex items-center gap-1.5 px-3 h-8 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-full text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] active:bg-[var(--color-primary-light)] transition-all disabled:opacity-50 shadow-sm"
                    >
                        <Navigation className="w-3.5 h-3.5" />
                        Map Day
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
                        Moving {getPatientName(selectedMoveAppointment.patientId, selectedMoveAppointment)}. Click a time slot to place it.
                    </p>
                </div>
            )}

            {/* Info banner when copying */}
            {selectedCopyAppointment && !draggingAppointmentId && (
                <div className="px-4 py-2 bg-teal-50 dark:bg-teal-950 border-b border-[var(--color-border)]">
                    <p className="text-sm text-teal-700 dark:text-teal-300">
                        Copying {getPatientName(selectedCopyAppointment.patientId, selectedCopyAppointment)}. Click a time slot to place the copy.
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
                                    <span className="text-[10px] text-[var(--color-text-tertiary)]">{Intl.DateTimeFormat().resolvedOptions().timeZone}</span>
                                </div>

                                {/* Day headers */}
                                {displayDates.map((date) => {
                                    const asDate = parseLocalDate(date);
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
                                        {slotMinutes % 60 === 0 && (
                                            <span className="absolute top-0 right-2 text-[10px] leading-none text-[var(--color-text-tertiary)]">
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
                                            if (draggingAppointmentIdRef.current) {
                                                updateDragPreview(
                                                    date,
                                                    getStartTimeFromColumnPosition(event)
                                                );
                                            }
                                            if (draggingNoteId) {
                                                setNoteDragPreview({
                                                    date,
                                                    startTime: getStartTimeFromColumnPosition(event),
                                                });
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
                                            const hourIndex = Math.floor(slotMinutes / 60);
                                            const isEvenHour = hourIndex % 2 === 0;

                                            return (
                                                <div
                                                    key={`slot-${date}-${slotTime}`}
                                                    role="button"
                                                    tabIndex={0}
                                                    onClick={() => handleSlotClick(date, slotTime)}
                                                    onDoubleClick={(e) => openSlotMenu(date, slotTime, e.currentTarget)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter' || e.key === ' ') {
                                                            e.preventDefault();
                                                            openSlotMenu(date, slotTime, e.currentTarget);
                                                        }
                                                    }}
                                                    onTouchStart={(e) => handleSlotLongPressStart(date, slotTime, e.currentTarget)}
                                                    onTouchMove={handleSlotLongPressEnd}
                                                    onTouchEnd={handleSlotLongPressEnd}
                                                    onTouchCancel={handleSlotLongPressEnd}
                                                    onDragOver={(event) => {
                                                        event.preventDefault();
                                                        event.dataTransfer.dropEffect = "move";
                                                        event.stopPropagation();
                                                        if (draggingAppointmentIdRef.current) {
                                                            updateDragPreview(date, slotTime);
                                                        }
                                                        if (draggingNoteId) {
                                                            setNoteDragPreview({ date, startTime: slotTime });
                                                        }
                                                    }}
                                                    onDrop={(event) => {
                                                        void handleSlotDrop(event, date, slotTime);
                                                    }}
                                                    className={`block w-full text-left transition-colors hover:bg-[var(--color-primary-light)]/30 cursor-pointer ${
                                                        isHourMark ? 'border-t grid-line-hour' : 'border-t grid-line-soft'
                                                    } ${isEvenHour ? 'hour-even' : 'hour-odd'}`}
                                                    style={{ height: SLOT_HEIGHT_PX }}
                                                    aria-label={`Double-click or hold to add appointment or note ${date} at ${formatAxisTime(slotMinutes)}`}
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
                                                // Divide width among overlapping appointments in both views
                                                const isDayView = viewMode === 'day';
                                                const widthPct = 100 / groupSize;
                                                const leftStyle = groupSize === 1 ? '4px' : `calc(${groupIndex * widthPct}% + 2px)`;
                                                const widthStyle = groupSize === 1 ? 'calc(100% - 8px)' : `calc(${widthPct}% - 4px)`;
                                                const isActiveMove =
                                                    moveAppointmentId === appointment.id ||
                                                    copyAppointmentId === appointment.id ||
                                                    draggingAppointmentId === appointment.id;
                                                const isActiveResize =
                                                    resizingAppointmentId === appointment.id;
                                                const isPersonal = isPersonalEvent(appointment);
                                                const patient = isPersonal ? undefined : getPatient(appointment.patientId);
                                                const legInfo = legInfoByAppointmentId[appointment.id];
                                                const visitType = appointment.visitType;
                                                const chipGradient = isPersonal
                                                    ? getPersonalCategoryGradient(appointment.personalCategory)
                                                    : getVisitTypeGradient(visitType);
                                                const chipName = isPersonal
                                                    ? (appointment.title || getPersonalCategoryLabel(appointment.personalCategory))
                                                    : getPatientName(appointment.patientId);
                                                const chipSubtitle = isPersonal
                                                    ? getPersonalCategoryLabel(appointment.personalCategory)
                                                    : (visitType ? `[${visitType}]` : null);
                                                const showFacilityRow = !isPersonal && heightPx >= 46;
                                                const showMilesRow = !isPersonal && heightPx >= 46;
                                                const showPhoneRow = !isPersonal && heightPx >= 58;
                                                const showAddressRow = !isPersonal && heightPx >= 72;
                                                const showAlternateContactRows = !isPersonal && heightPx >= 88;

                                                return (
                                                    <div
                                                        key={appointment.id}
                                                        draggable
                                                        onDragStart={(event) =>
                                                            handleAppointmentDragStart(event, appointment.id)
                                                        }
                                                        onDragEnd={handleAppointmentDragEnd}
                                                        onDragOver={(event) => {
                                                            event.preventDefault();
                                                            event.dataTransfer.dropEffect = "move";
                                                        }}
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
                                                            background: chipGradient,
                                                            touchAction: 'auto',
                                                            opacity: draggingAppointmentId === appointment.id ? 0.4 : undefined,
                                                        }}
                                                        title={isPersonal
                                                            ? chipName
                                                            : `${getPatientName(appointment.patientId)}${patient?.facilityName ? ` — ${patient.facilityName}` : ''}${patient?.phoneNumbers[0]?.number ? ` - ${patient.phoneNumbers[0].number}` : ''}${patient?.address ? ` - ${patient.address}` : ''}`
                                                        }
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
                                                                {chipName}
                                                            </div>
                                                            {chipSubtitle && (
                                                                <div className={`opacity-95 truncate w-full overflow-hidden font-medium tracking-wide ${
                                                                    isDayView ? 'text-[14px] min-h-[17px]' : 'text-[12px] min-h-[14px]'
                                                                }`}>
                                                                    {isPersonal ? chipSubtitle : `[${visitType}]`}
                                                                </div>
                                                            )}
                                                            <div className={`opacity-90 truncate w-full overflow-hidden ${
                                                                isDayView ? 'text-[14px] min-h-[17px]' : 'text-[12px] min-h-[14px]'
                                                            }`}>
                                                                {minutesToTimeString(startMinutes)} ({displayDuration}m)
                                                            </div>
                                                            {showFacilityRow && patient?.facilityName && (
                                                                <div className={`inline-flex w-fit max-w-full items-center gap-1 overflow-hidden whitespace-nowrap text-ellipsis opacity-90 ${
                                                                    isDayView ? 'text-[14px] min-h-[17px]' : 'text-[12px] min-h-[14px]'
                                                                }`}>
                                                                    <Building2 className={isDayView ? 'w-3.5 h-3.5 shrink-0' : 'w-2.5 h-2.5 shrink-0'} />
                                                                    <span className="truncate">{patient.facilityName}</span>
                                                                </div>
                                                            )}
                                                            {showMilesRow && legInfo?.miles != null && (
                                                                <div
                                                                    title={legInfo.isRealDistance
                                                                        ? 'Driving distance via Google Maps'
                                                                        : 'Estimated straight-line distance \u2014 driving distance unavailable'}
                                                                    className={`inline-flex items-center gap-1 opacity-90 truncate max-w-full overflow-hidden ${
                                                                    isDayView ? 'text-[14px] min-h-[17px]' : 'text-[12px] min-h-[14px]'
                                                                }`}>
                                                                    <Car className={isDayView ? 'w-3.5 h-3.5 shrink-0' : 'w-2.5 h-2.5 shrink-0'} />
                                                                    <span className="truncate">
                                                                        {legInfo.isRealDistance ? '' : '~'}{legInfo.miles.toFixed(1)} mi
                                                                        {legInfo.minutes != null && ` (${legInfo.isRealDistance ? '' : '~'}${legInfo.minutes} min)`}
                                                                    </span>
                                                                </div>
                                                            )}
                                                            {showPhoneRow && patient?.phoneNumbers[0]?.number && (
                                                                <div className={`inline-flex w-fit max-w-full items-center gap-1 overflow-hidden whitespace-nowrap text-ellipsis opacity-90 ${
                                                                    isDayView ? 'text-[14px] min-h-[17px]' : 'text-[12px] min-h-[14px]'
                                                                }`}>
                                                                    <Phone className={isDayView ? 'w-3.5 h-3.5 shrink-0' : 'w-2.5 h-2.5 shrink-0'} />
                                                                    <span className="truncate">{patient.phoneNumbers[0].number}</span>
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
                                                                    key={contact.phone || idx}
                                                                    className={`inline-flex w-fit max-w-full items-center gap-1 overflow-hidden whitespace-nowrap text-ellipsis opacity-85 ${
                                                                        isDayView ? 'text-[14px] min-h-[17px]' : 'text-[12px] min-h-[14px]'
                                                                    }`}
                                                                >
                                                                    <Phone className={isDayView ? 'w-3.5 h-3.5 shrink-0' : 'w-2.5 h-2.5 shrink-0'} />
                                                                    <span className="truncate">{contact.firstName ? `${contact.firstName}: ` : ''}{contact.phone}</span>
                                                                </div>
                                                            ))}
                                                        </div>

                                                        {/* Chip quick note banners (stacked) */}
                                                        {(() => {
                                                            const allNotes: string[] = [
                                                                ...(appointment.chipNotes ?? []),
                                                                ...((appointment.chipNote && !(appointment.chipNotes ?? []).includes(appointment.chipNote)) ? [appointment.chipNote] : []),
                                                            ];
                                                            const patientAllNotes: string[] = allNotes.length === 0 ? [
                                                                ...(patient?.chipNotes ?? []),
                                                                ...((patient?.chipNote && !(patient?.chipNotes ?? []).includes(patient?.chipNote)) ? [patient.chipNote] : []),
                                                            ] : [];
                                                            const displayNotes = allNotes.length > 0 ? allNotes : patientAllNotes;
                                                            if (displayNotes.length === 0) return null;
                                                            const noteColor = allNotes.length > 0 ? appointment.chipNoteColor : patient?.chipNoteColor;
                                                            const cc = getChipNoteClasses(noteColor);
                                                            return (
                                                                <div
                                                                    className="absolute bottom-0 left-0 right-0 pointer-events-none flex flex-col"
                                                                    style={{ zIndex: 2 }}
                                                                    title={displayNotes.join('\n')}
                                                                >
                                                                    {displayNotes.map((note, idx) => (
                                                                        <div
                                                                            key={note + idx}
                                                                            className={`${cc.bg} ${cc.text} text-[10px] font-semibold px-1.5 py-0.5 truncate leading-tight border-t ${cc.border} first:border-t-0`}
                                                                        >
                                                                            {note}
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            );
                                                        })()}

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
                                                const blockEnd = Math.min(endMinutes ?? DAY_END_MINUTES, DAY_END_MINUTES);

                                                if (blockEnd <= blockStart) {
                                                    return null;
                                                }

                                                const topPx = ((blockStart - DAY_START_MINUTES) / SLOT_MINUTES) * SLOT_HEIGHT_PX + 1;
                                                const heightPx = Math.max(
                                                    SLOT_HEIGHT_PX - 2,
                                                    ((blockEnd - blockStart) / SLOT_MINUTES) * SLOT_HEIGHT_PX - 2
                                                );

                                                // Use calendar color or default
                                                const bgColor = event.backgroundColor || "var(--color-event-green)";

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

                                            {/* Day note chips */}
                                            {(notesByDay[date] ?? [])
                                                .filter((note) => note.startMinutes != null)
                                                .map((note) => {
                                                    const noteStart = Math.max(note.startMinutes!, DAY_START_MINUTES);
                                                    const noteEnd = Math.min(note.startMinutes! + SLOT_MINUTES, DAY_END_MINUTES);
                                                    if (noteEnd <= noteStart) return null;
                                                    const noteTopPx = ((noteStart - DAY_START_MINUTES) / SLOT_MINUTES) * SLOT_HEIGHT_PX + 1;
                                                    const noteHeightPx = SLOT_HEIGHT_PX - 2;
                                                    return (
                                                        <DayNoteChip
                                                            key={note.id}
                                                            note={note}
                                                            topPx={noteTopPx}
                                                            heightPx={noteHeightPx}
                                                            isDragging={draggingNoteId === note.id}
                                                            isDayView={viewMode === 'day'}
                                                            onClick={() => {
                                                                setDayNotePrefillMinutes(note.startMinutes);
                                                                setDayNoteDate(note.date);
                                                            }}
                                                            onDelete={() => void deleteDayNote(note.id)}
                                                            onDragStart={(e) => handleNoteDragStart(e, note.id)}
                                                            onDragEnd={handleNoteDragEnd}
                                                            onTouchStart={(e) => handleNoteTouchStart(e, note.id, note.text)}
                                                            onTouchEnd={handleNoteTouchEnd}
                                                        />
                                                    );
                                                })}

                                            {/* Note drag preview */}
                                            {draggingNoteId &&
                                                noteDragPreview?.date === date &&
                                                (() => {
                                                    const nPreviewStart = timeStringToMinutes(noteDragPreview.startTime);
                                                    const nPreviewTop = ((Math.max(nPreviewStart, DAY_START_MINUTES) - DAY_START_MINUTES) / SLOT_MINUTES) * SLOT_HEIGHT_PX + 1;
                                                    return (
                                                        <div
                                                            className="absolute rounded border-2 border-dashed border-amber-500 bg-amber-500/20"
                                                            style={{
                                                                top: nPreviewTop,
                                                                height: SLOT_HEIGHT_PX - 2,
                                                                left: viewMode === 'day' ? '4px' : '2px',
                                                                width: viewMode === 'day' ? 'calc(100% - 8px)' : 'calc(100% - 4px)',
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
                        background: 'linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-hover) 100%)',
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

            {/* Floating ghost note during touch drag */}
            {touchDragNoteGhost && (
                <div
                    className="fixed z-50 pointer-events-none rounded text-xs shadow-2xl"
                    style={{
                        left: touchDragNoteGhost.x - 60,
                        top: touchDragNoteGhost.y - 20,
                        width: 120,
                        height: 36,
                        backgroundColor: '#fef9c3',
                        borderLeft: '3px solid #facc15',
                        color: '#713f12',
                        opacity: 0.9,
                    }}
                >
                    <div className="px-2 py-1.5 truncate font-medium text-[10px]">
                        {touchDragNoteGhost.text}
                    </div>
                </div>
            )}

            {/* Day Map Modal */}
            <DayMapModal
                isOpen={isDayMapOpen}
                onClose={() => setIsDayMapOpen(false)}
                selectedDate={selectedDate}
                selectedDayAppointments={selectedDayAppointments}
                homeCoordinates={homeCoordinates}
                getPatient={getPatient}
                resolvePatientCoordinatesForRouting={resolvePatientCoordinatesForRouting}
            />

            {/* Add Appointment Modal */}
            <AddAppointmentModal
                isOpen={isAddOpen}
                onClose={() => setIsAddOpen(false)}
                patients={patients}
                defaultDate={addPrefillDate}
                defaultTime={addPrefillTime}
                defaultIsPersonal={addPrefillIsPersonal}
                onCreated={(date) => {
                    setSelectedDate(date);
                    triggerSync();
                }}
            />

            {/* Floating Action Button */}
            <button
                onClick={() => openAddAppointment()}
                className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-[var(--color-primary)] text-white shadow-lg hover:shadow-xl hover:bg-[var(--color-primary-hover)] transition-all flex items-center justify-center"
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
                                    const href = buildAppleMapsHref(mapsMenuAddress);
                                    if (href) window.open(href, '_blank');
                                    setMapsMenuAddress(null);
                                }}
                                className="w-full py-3 px-4 text-left text-[var(--color-primary)] hover:bg-[var(--color-surface-hover)] rounded-lg font-medium"
                            >
                                Apple Maps
                            </button>
                            <button
                                onClick={() => {
                                    const href = buildGoogleMapsHref(mapsMenuAddress);
                                    if (href) window.open(href, '_blank');
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
                                    const href = buildAppleMapsHref(actionPatient.address);
                                    if (href) window.location.href = href;
                                } else {
                                    const href = buildGoogleMapsHref(actionPatient.address);
                                    if (href) window.open(href, '_blank');
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
                        onHold={() => {
                            void putOnHold(actionSheetAppointmentId);
                        }}
                        onChipNote={(notes, color) => {
                            void update(actionSheetAppointmentId, {
                                chipNotes: notes.length > 0 ? notes : undefined,
                                chipNote: undefined,
                                chipNoteColor: notes.length > 0 ? color : undefined,
                            });
                        }}
                        onPatientChipNote={(notes, color) => {
                            if (actionAppointment.patientId) {
                                void updatePatient(actionAppointment.patientId, {
                                    chipNotes: notes.length > 0 ? notes : undefined,
                                    chipNote: undefined,
                                    chipNoteColor: notes.length > 0 ? color : undefined,
                                });
                            }
                            // Clear appointment-level notes so patient-level takes over
                            void update(actionSheetAppointmentId, { chipNotes: undefined, chipNote: undefined, chipNoteColor: undefined });
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
                        onDeleteAppointment={async (appointmentId) => {
                            await deleteAppointment(appointmentId);
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

            {/* Slot Action Menu */}
            {slotActionMenu && (
                <SlotActionMenu
                    anchorRect={slotActionMenu.anchorRect}
                    onAddAppointment={() => {
                        openAddAppointment(slotActionMenu.date, slotActionMenu.startTime);
                        setSlotActionMenu(null);
                    }}
                    onAddNote={() => {
                        const startMinutes = timeStringToMinutes(slotActionMenu.startTime);
                        openNoteForSlot(slotActionMenu.date, startMinutes);
                        setSlotActionMenu(null);
                    }}
                    onClose={() => setSlotActionMenu(null)}
                />
            )}

            {/* Day Note Modal */}
            {dayNoteDate && (
                <DayNoteModal
                    date={dayNoteDate}
                    notes={notesByDay[dayNoteDate] ?? []}
                    onClose={() => {
                        setDayNoteDate(null);
                        setDayNotePrefillMinutes(undefined);
                    }}
                    onCreate={async (note) => {
                        await createDayNote(note);
                    }}
                    onUpdate={async (id, changes) => {
                        await updateDayNote(id, changes);
                    }}
                    onDelete={async (id) => {
                        await deleteDayNote(id);
                    }}
                    prefillStartMinutes={dayNotePrefillMinutes}
                />
            )}
        </div>
    );
}
