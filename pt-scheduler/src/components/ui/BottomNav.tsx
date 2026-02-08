import { NavLink } from "react-router-dom";

const navItems = [
    { to: "/", label: "Schedule", icon: "📅" },
    { to: "/patients", label: "Patients", icon: "👥" },
    { to: "/scan", label: "Scan", icon: "📷" },
    { to: "/route", label: "Route", icon: "🗺️" },
    { to: "/settings", label: "Settings", icon: "⚙️" },
];

export function BottomNav() {
    return (
        <nav className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-700 safe-area-pb">
            <div className="flex justify-around items-center h-16">
                {navItems.map(({ to, label, icon }) => (
                    <NavLink
                        key={to}
                        to={to}
                        className={({ isActive }) =>
                            `flex flex-col items-center justify-center w-full h-full transition-colors ${isActive
                                ? "text-blue-400"
                                : "text-gray-400 hover:text-gray-200"
                            }`
                        }
                        aria-label={label}
                    >
                        <span className="text-xl mb-1" role="img" aria-hidden="true">
                            {icon}
                        </span>
                        <span className="text-xs font-medium">{label}</span>
                    </NavLink>
                ))}
            </div>
        </nav>
    );
}
