import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: "primary" | "secondary" | "danger" | "ghost" | "text";
    size?: "sm" | "md" | "lg";
    children: ReactNode;
}

const variantStyles = {
    primary: "bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] text-white shadow-sm hover:shadow",
    secondary: "bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] text-[var(--color-primary)] border border-[var(--color-border)] hover:border-[var(--color-primary)]",
    danger: "bg-red-600 hover:bg-red-700 dark:bg-red-700 dark:hover:bg-red-800 text-white",
    ghost: "bg-transparent hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]",
    text: "bg-transparent hover:bg-[var(--color-primary-light)] text-[var(--color-primary)]",
};

const sizeStyles = {
    sm: "px-3 py-1.5 text-sm h-8",
    md: "px-4 py-2 text-sm h-9",
    lg: "px-6 py-2.5 text-base h-10",
};

export function Button({
    variant = "primary",
    size = "md",
    className = "",
    children,
    ...props
}: ButtonProps) {
    return (
        <button
            className={`
        inline-flex items-center justify-center
        font-medium rounded
        transition-all duration-150
        focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:ring-offset-2 focus:ring-offset-[var(--color-background)]
        disabled:opacity-50 disabled:cursor-not-allowed
        min-h-[36px] min-w-[36px]
        ${variantStyles[variant]}
        ${sizeStyles[size]}
        ${className}
      `}
            {...props}
        >
            {children}
        </button>
    );
}
