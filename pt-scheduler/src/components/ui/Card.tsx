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
        bg-white rounded-lg border border-[#dadce0]
        ${noPadding ? "" : "p-4"}
        ${isClickable ? "cursor-pointer hover:bg-[#f8f9fa] hover:border-[#bdc1c6] transition-colors" : ""}
        ${className}
      `}
            onClick={onClick}
            role={isClickable ? "button" : undefined}
            tabIndex={isClickable ? 0 : undefined}
            onKeyDown={isClickable ? (e) => e.key === "Enter" && onClick?.() : undefined}
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
                <h3 className="font-medium text-[#202124] text-base">{title}</h3>
                {subtitle && <p className="text-sm text-[#5f6368] mt-0.5">{subtitle}</p>}
            </div>
            {action && <div>{action}</div>}
        </div>
    );
}
