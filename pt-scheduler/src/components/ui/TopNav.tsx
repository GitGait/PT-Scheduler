import { NavLink } from "react-router-dom";
import {
  Menu,
  Calendar,
  Users,
  Camera,
  MapPin,
  Settings,
  HelpCircle,
  Search,
} from "lucide-react";

interface TopNavProps {
  onMenuClick: () => void;
  showMenuButton?: boolean;
}

const navItems = [
  { to: "/", label: "Schedule", icon: Calendar },
  { to: "/patients", label: "Patients", icon: Users },
  { to: "/scan", label: "Scan", icon: Camera },
  { to: "/route", label: "Route", icon: MapPin },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function TopNav({ onMenuClick, showMenuButton = true }: TopNavProps) {
  return (
    <header className="h-16 border-b border-[#dadce0] bg-white flex items-center px-4 flex-shrink-0">
      {/* Left section */}
      <div className="flex items-center gap-2">
        {showMenuButton && (
          <button
            onClick={onMenuClick}
            className="w-12 h-12 flex items-center justify-center rounded-full hover:bg-[#f1f3f4] transition-colors"
            aria-label="Toggle menu"
          >
            <Menu className="w-6 h-6 text-[#5f6368]" />
          </button>
        )}
      </div>

      {/* Center navigation */}
      <nav className="flex-1 flex items-center justify-center gap-1">
        {navItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-2 px-4 h-10 rounded-full text-sm font-medium transition-colors ${
                isActive
                  ? "bg-[#e8f0fe] text-[#1a73e8]"
                  : "text-[#5f6368] hover:bg-[#f1f3f4]"
              }`
            }
          >
            <Icon className="w-5 h-5" />
            <span className="hidden md:inline">{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Right section */}
      <div className="flex items-center gap-1">
        <button
          className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-[#f1f3f4] transition-colors"
          aria-label="Search"
        >
          <Search className="w-5 h-5 text-[#5f6368]" />
        </button>
        <button
          className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-[#f1f3f4] transition-colors"
          aria-label="Help"
        >
          <HelpCircle className="w-5 h-5 text-[#5f6368]" />
        </button>
      </div>
    </header>
  );
}
