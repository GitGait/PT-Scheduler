import type { ReactNode } from "react";

interface CardProps {
    children: ReactNode;
    className?: string;
    onClick?: () => void;
    noPadding?: boolean;
}

export function Card({ children, className = "", onClick, noPadding = false }: CardProps) {
    const isClickable = !!onClick;

    return (
        <div
            className={`
        bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] transition-colors duration-200
        ${noPadding ? "" : "p-4"}
        ${isClickable ? "cursor-pointer hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-text-tertiary)] transition-colors" : ""}
        ${className}
      `}
            onClick={onClick}
            role={isClickable ? "button" : undefined}
            tabIndex={isClickable ? 0 : undefined}
            onKeyDown={isClickable ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onClick?.();
                }
            } : undefined}
        >
            {children}
        </div>
    );
}

interface CardHeaderProps {
    title: string;
    subtitle?: string;
    action?: ReactNode;
}

export function CardHeader({ title, subtitle, action }: CardHeaderProps) {
    return (
        <div className="flex items-start justify-between mb-3">
            <div>
                <h3 className="font-medium text-[var(--color-text-primary)] text-base">{title}</h3>
                {subtitle && <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">{subtitle}</p>}
            </div>
            {action && <div>{action}</div>}
        </div>
    );
}
