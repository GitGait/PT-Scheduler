import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronDown, PauseCircle } from "lucide-react";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  addMonths,
  subMonths,
  isSameMonth,
  isSameDay,
  isToday,
} from "date-fns";
import { useScheduleStore, useAppointmentStore, usePatientStore } from "../../stores";
import { listCalendars } from "../../api/calendar";
import { isSignedIn } from "../../api/auth";
import { isPersonalEvent, getPersonalCategoryLabel } from "../../utils/personalEventColors";

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDate?: Date;
  onDateSelect?: (date: Date) => void;
}

export function Sidebar({
  isOpen,
  selectedDate = new Date(),
  onDateSelect,
}: SidebarProps) {
  const {
    googleCalendars,
    setGoogleCalendars,
    enabledCalendars,
    toggleCalendar,
    loadingCalendars,
    setLoadingCalendars,
    setPendingRestoreFromHoldId,
  } = useScheduleStore();

  const { onHoldAppointments, restoreFromHold } = useAppointmentStore();
  const { patients } = usePatientStore();

  const [myCalendarsOpen, setMyCalendarsOpen] = useState(false);
  const [otherCalendarsOpen, setOtherCalendarsOpen] = useState(false);
  const [onHoldOpen, setOnHoldOpen] = useState(false);

  // Fetch calendars when sidebar opens and when app regains focus.
  useEffect(() => {
    const abortController = new AbortController();

    const fetchCalendars = async () => {
      if (!isSignedIn()) {
        if (!abortController.signal.aborted) {
          setGoogleCalendars([]);
          setLoadingCalendars(false);
        }
        return;
      }

      setLoadingCalendars(true);
      try {
        const calendars = await listCalendars();
        if (!abortController.signal.aborted) {
          setGoogleCalendars(calendars);
        }
      } catch (err) {
        if (!abortController.signal.aborted) {
          console.error("Failed to fetch calendars:", err);
        }
      } finally {
        if (!abortController.signal.aborted) {
          setLoadingCalendars(false);
        }
      }
    };

    if (isOpen) {
      void fetchCalendars();
    }

    const handleFocus = () => {
      if (isOpen && !abortController.signal.aborted) {
        void fetchCalendars();
      }
    };

    window.addEventListener("focus", handleFocus);
    return () => {
      abortController.abort();
      window.removeEventListener("focus", handleFocus);
    };
  }, [isOpen, setGoogleCalendars, setLoadingCalendars]);

  // Auto-expand on-hold section when items exist, collapse when empty
  useEffect(() => {
    setOnHoldOpen(onHoldAppointments.length > 0);
  }, [onHoldAppointments.length]);

  const patientById = useMemo(() => {
    const map = new Map<string, (typeof patients)[number]>();
    for (const p of patients) map.set(p.id, p);
    return map;
  }, [patients]);

  const handleRestoreFromHold = async (appointmentId: string) => {
    await restoreFromHold(appointmentId);
    setPendingRestoreFromHoldId(appointmentId);
  };

  // Split calendars into "my" (primary + owned) and "other" (subscribed)
  const { myCalendars, otherCalendars } = useMemo(() => {
    const my: typeof googleCalendars = [];
    const other: typeof googleCalendars = [];

    for (const cal of googleCalendars) {
      // Calendars with @ are usually owned, others are subscribed
      if (cal.primary || cal.id.includes("@gmail.com") || (cal.id.includes("@group.calendar.google.com") && !cal.id.includes("#"))) {
        my.push(cal);
      } else {
        other.push(cal);
      }
    }

    return { myCalendars: my, otherCalendars: other };
  }, [googleCalendars]);

  return (
    <aside
      className={`sidebar bg-[var(--color-sidebar-bg)] border-r border-[var(--color-border)] flex-shrink-0 overflow-y-auto transition-all duration-200 ${
        isOpen ? "w-64" : "w-0 overflow-hidden"
      }`}
    >
      <div className="p-4 space-y-6">
        {/* Mini Calendar */}
        <MiniCalendar
          selectedDate={selectedDate}
          onDateSelect={onDateSelect}
        />

        {/* My Calendars Section */}
        <div>
          <button
            onClick={() => setMyCalendarsOpen(!myCalendarsOpen)}
            className="flex items-center gap-2 w-full text-left py-2 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] rounded px-2 -mx-2"
          >
            <ChevronDown className={`w-4 h-4 transition-transform ${myCalendarsOpen ? "" : "-rotate-90"}`} />
            <span>My calendars</span>
          </button>
          {myCalendarsOpen && (
            <div className="ml-6 space-y-1 mt-1">
              {/* PT Appointments - always shown */}
              <label className="flex items-center gap-3 py-1.5 px-2 rounded hover:bg-[var(--color-surface-hover)] cursor-pointer">
                <input
                  type="checkbox"
                  checked={enabledCalendars["pt-appointments"] !== false}
                  onChange={() => toggleCalendar("pt-appointments")}
                  className="w-4 h-4 rounded border-2"
                  style={{ accentColor: "var(--color-event-blue)" }}
                />
                <span className="text-sm text-[var(--color-text-primary)]">PT Appointments</span>
              </label>

              {loadingCalendars ? (
                <p className="text-xs text-[var(--color-text-secondary)] py-1 px-2">Loading...</p>
              ) : (
                myCalendars.map((cal) => (
                  <label
                    key={cal.id}
                    className="flex items-center gap-3 py-1.5 px-2 rounded hover:bg-[var(--color-surface-hover)] cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={enabledCalendars[cal.id] !== false}
                      onChange={() => toggleCalendar(cal.id)}
                      className="w-4 h-4 rounded border-2"
                      style={{ accentColor: cal.backgroundColor || "var(--color-event-green)" }}
                    />
                    <span className="text-sm text-[var(--color-text-primary)] truncate">
                      {cal.primary ? "Personal" : cal.summary}
                    </span>
                  </label>
                ))
              )}
            </div>
          )}
        </div>

        {/* Other Calendars Section */}
        {otherCalendars.length > 0 && (
          <div>
            <button
              onClick={() => setOtherCalendarsOpen(!otherCalendarsOpen)}
              className="flex items-center gap-2 w-full text-left py-2 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] rounded px-2 -mx-2"
            >
              <ChevronDown className={`w-4 h-4 transition-transform ${otherCalendarsOpen ? "" : "-rotate-90"}`} />
              <span>Other calendars</span>
            </button>
            {otherCalendarsOpen && (
              <div className="ml-6 space-y-1 mt-1">
                {otherCalendars.map((cal) => (
                  <label
                    key={cal.id}
                    className="flex items-center gap-3 py-1.5 px-2 rounded hover:bg-[var(--color-surface-hover)] cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={enabledCalendars[cal.id] !== false}
                      onChange={() => toggleCalendar(cal.id)}
                      className="w-4 h-4 rounded border-2"
                      style={{ accentColor: cal.backgroundColor || "var(--color-event-green)" }}
                    />
                    <span className="text-sm text-[var(--color-text-primary)] truncate">{cal.summary}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
        {/* On Hold Section */}
        {onHoldAppointments.length > 0 && (
          <div>
            <button
              onClick={() => setOnHoldOpen(!onHoldOpen)}
              className="flex items-center gap-2 w-full text-left py-2 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] rounded px-2 -mx-2"
            >
              <ChevronDown className={`w-4 h-4 transition-transform ${onHoldOpen ? "" : "-rotate-90"}`} />
              <PauseCircle className="w-4 h-4 text-amber-500" />
              <span>On hold</span>
              <span className="ml-auto text-xs bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 rounded-full px-1.5 py-0.5 font-medium">
                {onHoldAppointments.length}
              </span>
            </button>
            {onHoldOpen && (
              <div className="ml-2 space-y-1 mt-1">
                {onHoldAppointments.map((apt) => {
                  const patient = patientById.get(apt.patientId);
                  const name = isPersonalEvent(apt)
                    ? (apt.title || getPersonalCategoryLabel(apt.personalCategory))
                    : (patient?.fullName ?? "Unknown");
                  return (
                    <button
                      key={apt.id}
                      onClick={() => void handleRestoreFromHold(apt.id)}
                      className="w-full text-left p-2 rounded-lg hover:bg-[var(--color-surface-hover)] transition-colors border-l-3 border-amber-400 dark:border-amber-500"
                    >
                      <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">{name}</p>
                      <p className="text-xs text-[var(--color-text-secondary)]">
                        {apt.date} &middot; {apt.visitType || "Personal"}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

interface MiniCalendarProps {
  selectedDate: Date;
  onDateSelect?: (date: Date) => void;
}

function MiniCalendar({ selectedDate, onDateSelect }: MiniCalendarProps) {
  const [viewMonth, setViewMonth] = useState(startOfMonth(selectedDate));

  const weeks = useMemo(() => {
    const monthStart = startOfMonth(viewMonth);
    const monthEnd = endOfMonth(viewMonth);
    const calStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });

    const rows: Date[][] = [];
    let day = calStart;

    while (day <= calEnd) {
      const week: Date[] = [];
      for (let i = 0; i < 7; i++) {
        week.push(day);
        day = addDays(day, 1);
      }
      rows.push(week);
    }

    return rows;
  }, [viewMonth]);

  const weekDays = ["M", "T", "W", "T", "F", "S", "S"];

  return (
    <div className="mini-calendar">
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-[var(--color-text-primary)]">
          {format(viewMonth, "MMMM yyyy")}
        </span>
        <div className="flex gap-0.5">
          <button
            onClick={() => setViewMonth(subMonths(viewMonth, 1))}
            className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[var(--color-surface-hover)]"
            aria-label="Previous month"
          >
            <ChevronLeft className="w-4 h-4 text-[var(--color-text-secondary)]" />
          </button>
          <button
            onClick={() => setViewMonth(addMonths(viewMonth, 1))}
            className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[var(--color-surface-hover)]"
            aria-label="Next month"
          >
            <ChevronRight className="w-4 h-4 text-[var(--color-text-secondary)]" />
          </button>
        </div>
      </div>

      {/* Week day headers */}
      <div className="grid grid-cols-7">
        {weekDays.map((day, index) => (
          <div
            key={index}
            className="h-7 flex items-center justify-center text-[11px] font-medium text-[var(--color-text-tertiary)]"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar days */}
      <div>
        {weeks.map((week, weekIndex) => (
          <div key={weekIndex} className="grid grid-cols-7">
            {week.map((day, dayIndex) => {
              const isCurrentMonth = isSameMonth(day, viewMonth);
              const isSelected = isSameDay(day, selectedDate);
              const isTodayDate = isToday(day);

              return (
                <button
                  key={dayIndex}
                  onClick={() => onDateSelect?.(day)}
                  className="h-7 flex items-center justify-center"
                >
                  <span
                    className={`w-6 h-6 flex items-center justify-center text-[11px] rounded-full transition-colors ${
                      !isCurrentMonth
                        ? "text-[var(--color-text-tertiary)]"
                        : isTodayDate
                        ? "bg-[var(--color-primary)] text-white font-medium"
                        : isSelected
                        ? "bg-[var(--color-primary-light)] text-[var(--color-primary)] font-medium"
                        : "text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
                    }`}
                  >
                    {format(day, "d")}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
