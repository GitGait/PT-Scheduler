import { NavLink } from "react-router-dom";
import { Calendar, Users, Camera, Settings, type LucideIcon } from "lucide-react";

const navItems: { to: string; label: string; icon: LucideIcon }[] = [
    { to: "/", label: "Schedule", icon: Calendar },
    { to: "/patients", label: "Patients", icon: Users },
    { to: "/scan", label: "Scan", icon: Camera },
    { to: "/settings", label: "Settings", icon: Settings },
];

export function BottomNav() {
    return (
        <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-[var(--color-surface)] border-t border-[var(--color-border)] safe-area-pb">
            <div className="flex justify-around items-center h-16">
                {navItems.map(({ to, label, icon: Icon }) => (
                    <NavLink
                        key={to}
                        to={to}
                        end={to === "/"}
                        className={({ isActive }) =>
                            `flex flex-col items-center justify-center w-full h-full transition-colors ${isActive
                                ? "text-[var(--color-primary)]"
                                : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                            }`
                        }
                        aria-label={label}
                    >
                        <Icon className="w-5 h-5 mb-1" aria-hidden="true" />
                        <span className="text-xs font-medium">{label}</span>
                    </NavLink>
                ))}
            </div>
        </nav>
    );
}
