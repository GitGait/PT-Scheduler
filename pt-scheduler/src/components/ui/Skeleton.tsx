import { type ReactNode } from "react";

interface SkeletonProps {
  className?: string;
  width?: string | number;
  height?: string | number;
  variant?: "text" | "circle" | "chip" | "card" | "custom";
}

export function Skeleton({
  className = "",
  width,
  height,
  variant = "custom",
}: SkeletonProps) {
  const variantClasses = {
    text: "skeleton skeleton-text",
    circle: "skeleton skeleton-circle",
    chip: "skeleton skeleton-chip",
    card: "skeleton skeleton-card",
    custom: "skeleton",
  };

  const style: React.CSSProperties = {};
  if (width) style.width = typeof width === "number" ? `${width}px` : width;
  if (height) style.height = typeof height === "number" ? `${height}px` : height;

  return (
    <div
      className={`${variantClasses[variant]} ${className}`}
      style={style}
      aria-hidden="true"
    />
  );
}

interface SkeletonRowProps {
  children: ReactNode;
  className?: string;
}

export function SkeletonRow({ children, className = "" }: SkeletonRowProps) {
  return <div className={`skeleton-row ${className}`}>{children}</div>;
}

interface SkeletonGroupProps {
  children: ReactNode;
  stagger?: boolean;
  className?: string;
}

export function SkeletonGroup({
  children,
  stagger = true,
  className = "",
}: SkeletonGroupProps) {
  return (
    <div className={`${stagger ? "skeleton-stagger" : ""} ${className}`}>
      {children}
    </div>
  );
}

// Pre-built skeleton layouts for common use cases

export function ScheduleGridSkeleton() {
  return (
    <div className="flex-1 overflow-hidden" aria-label="Loading schedule...">
      {/* Day headers skeleton */}
      <div className="flex border-b border-[var(--color-border)]">
        <div className="w-16 flex-shrink-0" />
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex-1 p-3 flex flex-col items-center gap-2">
            <Skeleton width={24} height={12} />
            <Skeleton width={28} height={28} variant="circle" />
          </div>
        ))}
      </div>

      {/* Time slots skeleton */}
      <div className="relative">
        <SkeletonGroup stagger>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex border-b border-[var(--color-border-light)]">
              <div className="w-16 flex-shrink-0 py-3 px-2">
                <Skeleton width={32} height={10} />
              </div>
              <div className="flex-1 flex">
                {Array.from({ length: 7 }).map((_, j) => (
                  <div
                    key={j}
                    className="flex-1 border-l border-[var(--color-border-light)] p-1"
                    style={{ height: 48 }}
                  >
                    {/* Random appointment skeletons */}
                    {Math.random() > 0.7 && (
                      <Skeleton
                        height={Math.random() > 0.5 ? 44 : 88}
                        className="rounded"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </SkeletonGroup>
      </div>
    </div>
  );
}

export function PatientListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="space-y-3" aria-label="Loading patients...">
      <SkeletonGroup stagger>
        {Array.from({ length: count }).map((_, i) => (
          <div
            key={i}
            className="skeleton-card flex items-center gap-4 p-4"
          >
            <Skeleton width={48} height={48} variant="circle" />
            <div className="flex-1">
              <Skeleton width="60%" height={16} className="mb-2" />
              <Skeleton width="40%" height={12} />
            </div>
            <Skeleton width={80} height={32} className="rounded-full" />
          </div>
        ))}
      </SkeletonGroup>
    </div>
  );
}

export function AppointmentChipSkeleton({ count = 3 }: { count?: number }) {
  return (
    <SkeletonGroup stagger className="space-y-1">
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton
          key={i}
          variant="chip"
          height={48 + Math.floor(Math.random() * 24)}
        />
      ))}
    </SkeletonGroup>
  );
}

export function CardSkeleton() {
  return (
    <div className="skeleton-card" aria-label="Loading...">
      <div className="flex items-center gap-3 mb-4">
        <Skeleton width={40} height={40} variant="circle" />
        <div className="flex-1">
          <Skeleton width="50%" height={16} className="mb-2" />
          <Skeleton width="30%" height={12} />
        </div>
      </div>
      <Skeleton width="100%" height={14} className="mb-2" />
      <Skeleton width="80%" height={14} className="mb-2" />
      <Skeleton width="60%" height={14} />
    </div>
  );
}

export function RouteStopSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-4" aria-label="Loading route...">
      <SkeletonGroup stagger>
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="flex gap-4">
            <div className="flex flex-col items-center">
              <Skeleton width={32} height={32} variant="circle" />
              {i < count - 1 && (
                <div className="w-0.5 h-12 bg-[var(--color-skeleton)] mt-2" />
              )}
            </div>
            <div className="flex-1 skeleton-card">
              <Skeleton width="70%" height={16} className="mb-2" />
              <Skeleton width="50%" height={12} className="mb-3" />
              <div className="flex gap-4">
                <Skeleton width={60} height={12} />
                <Skeleton width={80} height={12} />
              </div>
            </div>
          </div>
        ))}
      </SkeletonGroup>
    </div>
  );
}
