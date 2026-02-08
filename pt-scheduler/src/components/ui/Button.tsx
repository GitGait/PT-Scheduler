import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: "primary" | "secondary" | "danger" | "ghost" | "text";
    size?: "sm" | "md" | "lg";
    children: ReactNode;
}

const variantStyles = {
    primary: "bg-[#1a73e8] hover:bg-[#1557b0] text-white shadow-sm hover:shadow",
    secondary: "bg-white hover:bg-[#f1f3f4] text-[#1a73e8] border border-[#dadce0] hover:border-[#1a73e8]",
    danger: "bg-[#d93025] hover:bg-[#b3261e] text-white",
    ghost: "bg-transparent hover:bg-[#f1f3f4] text-[#5f6368]",
    text: "bg-transparent hover:bg-[#e8f0fe] text-[#1a73e8]",
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
        focus:outline-none focus:ring-2 focus:ring-[#1a73e8] focus:ring-offset-2
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
