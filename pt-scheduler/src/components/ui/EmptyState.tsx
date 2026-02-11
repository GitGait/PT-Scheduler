import { type ReactNode, type ComponentType } from "react";
import {
  Calendar,
  Users,
  MapPin,
  Camera,
  FileText,
  Search,
  Plus,
  type LucideProps,
} from "lucide-react";

interface EmptyStateProps {
  icon?: ComponentType<LucideProps>;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
    icon?: ComponentType<LucideProps>;
  };
  children?: ReactNode;
  animated?: boolean;
}

export function EmptyState({
  icon: Icon = FileText,
  title,
  description,
  action,
  children,
  animated = true,
}: EmptyStateProps) {
  const ActionIcon = action?.icon || Plus;

  return (
    <div className="empty-state">
      <Icon
        className={`empty-state-icon ${animated ? "empty-state-icon-animated" : ""}`}
      />
      <h3 className="empty-state-title">{title}</h3>
      {description && <p className="empty-state-description">{description}</p>}
      {action && (
        <button className="empty-state-action" onClick={action.onClick}>
          <ActionIcon className="w-4 h-4" />
          {action.label}
        </button>
      )}
      {children}
    </div>
  );
}

// Pre-built empty states for common use cases

interface ScheduleEmptyStateProps {
  onAddAppointment?: () => void;
  dateLabel?: string;
}

export function ScheduleEmptyState({
  onAddAppointment,
  dateLabel = "today",
}: ScheduleEmptyStateProps) {
  return (
    <EmptyState
      icon={Calendar}
      title={`No appointments ${dateLabel}`}
      description="Your schedule is clear. Add an appointment to get started, or scan a schedule screenshot to import appointments."
      action={
        onAddAppointment
          ? {
              label: "Add Appointment",
              onClick: onAddAppointment,
            }
          : undefined
      }
    />
  );
}

interface PatientsEmptyStateProps {
  onAddPatient?: () => void;
}

export function PatientsEmptyState({ onAddPatient }: PatientsEmptyStateProps) {
  return (
    <EmptyState
      icon={Users}
      title="No patients yet"
      description="Add your first patient to start scheduling appointments. You can also import patients from a CSV file."
      action={
        onAddPatient
          ? {
              label: "Add Patient",
              onClick: onAddPatient,
            }
          : undefined
      }
    />
  );
}

interface RouteEmptyStateProps {
  onViewSchedule?: () => void;
  hasAppointments?: boolean;
}

export function RouteEmptyState({
  onViewSchedule,
  hasAppointments = false,
}: RouteEmptyStateProps) {
  return (
    <EmptyState
      icon={MapPin}
      title={hasAppointments ? "Configure your home base" : "No stops to optimize"}
      description={
        hasAppointments
          ? "Set your home address in Settings to calculate optimal routes between appointments."
          : "Add appointments to your schedule first, then come back here to optimize your route."
      }
      action={
        onViewSchedule
          ? {
              label: hasAppointments ? "Go to Settings" : "View Schedule",
              onClick: onViewSchedule,
              icon: hasAppointments ? undefined : Calendar,
            }
          : undefined
      }
    />
  );
}

interface ScanEmptyStateProps {
  onSelectImage?: () => void;
}

export function ScanEmptyState({ onSelectImage }: ScanEmptyStateProps) {
  return (
    <EmptyState
      icon={Camera}
      title="Scan a schedule"
      description="Upload a screenshot of your schedule and we'll automatically extract appointments using OCR."
      action={
        onSelectImage
          ? {
              label: "Select Image",
              onClick: onSelectImage,
              icon: Camera,
            }
          : undefined
      }
    />
  );
}

interface SearchEmptyStateProps {
  query: string;
  onClearSearch?: () => void;
}

export function SearchEmptyState({
  query,
  onClearSearch,
}: SearchEmptyStateProps) {
  return (
    <EmptyState
      icon={Search}
      title="No results found"
      description={`We couldn't find anything matching "${query}". Try adjusting your search terms.`}
      action={
        onClearSearch
          ? {
              label: "Clear Search",
              onClick: onClearSearch,
              icon: Search,
            }
          : undefined
      }
      animated={false}
    />
  );
}

// Compact inline empty state for smaller containers
interface InlineEmptyStateProps {
  icon?: ComponentType<LucideProps>;
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function InlineEmptyState({
  icon: Icon = FileText,
  message,
  action,
}: InlineEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
      <Icon className="w-10 h-10 text-[var(--color-empty-icon)] opacity-60 mb-3" />
      <p className="text-sm text-[var(--color-text-secondary)] mb-3">{message}</p>
      {action && (
        <button
          className="text-sm font-medium text-[var(--color-primary)] hover:underline"
          onClick={action.onClick}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
