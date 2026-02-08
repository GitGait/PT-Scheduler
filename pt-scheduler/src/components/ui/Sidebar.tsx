import { useMemo, useState } from "react";
import { Plus, ChevronLeft, ChevronRight, ChevronDown } from "lucide-react";
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

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  selectedDate?: Date;
  onDateSelect?: (date: Date) => void;
  onCreateClick?: () => void;
}

export function Sidebar({
  isOpen,
  selectedDate = new Date(),
  onDateSelect,
  onCreateClick,
}: SidebarProps) {
  return (
    <aside
      className={`sidebar bg-white border-r border-[#dadce0] flex-shrink-0 overflow-y-auto transition-all duration-200 ${
        isOpen ? "w-64" : "w-0 overflow-hidden"
      }`}
    >
      <div className="p-4 space-y-6">
        {/* Create Button */}
        <button
          onClick={onCreateClick}
          className="btn-create w-auto"
        >
          <Plus className="w-9 h-9 text-[#1a73e8]" />
          <span>Create</span>
        </button>

        {/* Mini Calendar */}
        <MiniCalendar
          selectedDate={selectedDate}
          onDateSelect={onDateSelect}
        />

        {/* My Calendars Section */}
        <div>
          <button className="flex items-center gap-2 w-full text-left py-2 text-sm font-medium text-[#3c4043] hover:bg-[#f1f3f4] rounded px-2 -mx-2">
            <ChevronDown className="w-4 h-4" />
            <span>My calendars</span>
          </button>
          <div className="ml-6 space-y-1 mt-1">
            <label className="flex items-center gap-3 py-1.5 px-2 rounded hover:bg-[#f1f3f4] cursor-pointer">
              <input
                type="checkbox"
                defaultChecked
                className="w-4 h-4 rounded border-2 border-[#039be5] accent-[#039be5]"
              />
              <span className="text-sm text-[#3c4043]">Appointments</span>
            </label>
            <label className="flex items-center gap-3 py-1.5 px-2 rounded hover:bg-[#f1f3f4] cursor-pointer">
              <input
                type="checkbox"
                defaultChecked
                className="w-4 h-4 rounded border-2 border-[#33b679] accent-[#33b679]"
              />
              <span className="text-sm text-[#3c4043]">Personal</span>
            </label>
          </div>
        </div>

        {/* Other Calendars Section */}
        <div>
          <button className="flex items-center gap-2 w-full text-left py-2 text-sm font-medium text-[#3c4043] hover:bg-[#f1f3f4] rounded px-2 -mx-2">
            <ChevronDown className="w-4 h-4" />
            <span>Other calendars</span>
          </button>
          <div className="ml-6 space-y-1 mt-1">
            <label className="flex items-center gap-3 py-1.5 px-2 rounded hover:bg-[#f1f3f4] cursor-pointer">
              <input
                type="checkbox"
                defaultChecked
                className="w-4 h-4 rounded border-2 border-[#0b8043] accent-[#0b8043]"
              />
              <span className="text-sm text-[#3c4043]">Holidays in United States</span>
            </label>
          </div>
        </div>
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
    const calStart = startOfWeek(monthStart);
    const calEnd = endOfWeek(monthEnd);

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

  const weekDays = ["S", "M", "T", "W", "T", "F", "S"];

  return (
    <div className="mini-calendar">
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-[#3c4043]">
          {format(viewMonth, "MMMM yyyy")}
        </span>
        <div className="flex gap-1">
          <button
            onClick={() => setViewMonth(subMonths(viewMonth, 1))}
            className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-[#f1f3f4]"
            aria-label="Previous month"
          >
            <ChevronLeft className="w-4 h-4 text-[#5f6368]" />
          </button>
          <button
            onClick={() => setViewMonth(addMonths(viewMonth, 1))}
            className="w-6 h-6 flex items-center justify-center rounded-full hover:bg-[#f1f3f4]"
            aria-label="Next month"
          >
            <ChevronRight className="w-4 h-4 text-[#5f6368]" />
          </button>
        </div>
      </div>

      {/* Week day headers */}
      <div className="grid grid-cols-7 mb-1">
        {weekDays.map((day, index) => (
          <div
            key={index}
            className="w-8 h-8 flex items-center justify-center text-xs font-medium text-[#70757a]"
          >
            {day}
          </div>
        ))}
      </div>

      {/* Calendar days */}
      <div className="space-y-0.5">
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
                  className={`w-8 h-8 flex items-center justify-center text-xs rounded-full transition-colors ${
                    !isCurrentMonth
                      ? "text-[#70757a]"
                      : isTodayDate
                      ? "bg-[#1a73e8] text-white font-medium"
                      : isSelected
                      ? "bg-[#e8f0fe] text-[#1a73e8] font-medium"
                      : "text-[#3c4043] hover:bg-[#f1f3f4]"
                  }`}
                >
                  {format(day, "d")}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
