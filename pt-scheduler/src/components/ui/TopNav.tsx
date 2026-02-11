import { useState, useEffect, useCallback, useRef } from "react";
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
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { isSignedIn, signIn, tryRestoreSignIn } from "../../api/auth";
import { AUTH_STATE_CHANGED_EVENT } from "../../pages/SettingsPage";

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
  const [googleSignedIn, setGoogleSignedIn] = useState(() => isSignedIn());
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const errorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Check sign-in status periodically and on visibility change
  useEffect(() => {
    const checkStatus = () => {
      setGoogleSignedIn(isSignedIn());
    };

    // Check immediately
    checkStatus();

    // Check every 30 seconds (tokens can expire)
    const interval = setInterval(checkStatus, 30000);

    // Check when tab becomes visible again
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        checkStatus();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Listen for auth state changes from Settings page
    const handleAuthStateChange = () => {
      checkStatus();
    };
    window.addEventListener(AUTH_STATE_CHANGED_EVENT, handleAuthStateChange);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener(AUTH_STATE_CHANGED_EVENT, handleAuthStateChange);
    };
  }, []);

  // Try to restore sign-in on mount
  useEffect(() => {
    const restore = async () => {
      const restored = await tryRestoreSignIn();
      setGoogleSignedIn(restored);
    };
    void restore();
  }, []);

  // Clear error timeout on unmount
  useEffect(() => {
    return () => {
      if (errorTimeoutRef.current) {
        clearTimeout(errorTimeoutRef.current);
      }
    };
  }, []);

  const handleSignInClick = useCallback(async () => {
    if (googleSignedIn || isSigningIn) return;

    setSignInError(null);
    setIsSigningIn(true);

    try {
      await signIn();
      setGoogleSignedIn(true);
    } catch (err) {
      console.error("Sign-in failed:", err);
      const message = err instanceof Error ? err.message : "Sign-in failed";
      setSignInError(message.includes("popup") ? "Popup blocked" : "Failed");

      // Clear error after 3 seconds
      if (errorTimeoutRef.current) {
        clearTimeout(errorTimeoutRef.current);
      }
      errorTimeoutRef.current = setTimeout(() => {
        setSignInError(null);
      }, 3000);
    } finally {
      setIsSigningIn(false);
    }
  }, [googleSignedIn, isSigningIn]);

  return (
    <header className="h-16 border-b border-[var(--color-border)] bg-[var(--color-surface)] flex items-center px-4 flex-shrink-0 transition-colors duration-200">
      {/* Left section */}
      <div className="flex items-center gap-2">
        {showMenuButton && (
          <button
            onClick={onMenuClick}
            className="w-12 h-12 flex items-center justify-center rounded-full hover:bg-[var(--color-surface-hover)] transition-colors"
            aria-label="Toggle menu"
          >
            <Menu className="w-6 h-6 text-[var(--color-text-secondary)]" />
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
                  ? "bg-[var(--color-primary-light)] text-[var(--color-primary)]"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
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
        {/* Google Sign-in Status Indicator */}
        <button
          onClick={handleSignInClick}
          disabled={googleSignedIn || isSigningIn}
          className={`flex items-center gap-2 px-3 h-9 rounded-full text-xs font-medium transition-all shadow-sm border ${
            signInError
              ? "bg-red-50 dark:bg-red-950 border-red-400 dark:border-red-700 text-red-700 dark:text-red-300 cursor-pointer"
              : googleSignedIn
              ? "bg-green-50 dark:bg-green-950 border-green-400 dark:border-green-700 text-green-700 dark:text-green-300 cursor-default"
              : isSigningIn
              ? "bg-yellow-50 dark:bg-yellow-950 border-yellow-400 dark:border-yellow-700 text-yellow-700 dark:text-yellow-300 cursor-wait"
              : "bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] cursor-pointer"
          }`}
          title={
            signInError
              ? `Error: ${signInError}. Click to retry.`
              : googleSignedIn
              ? "Connected to Google"
              : "Click to sign in to Google"
          }
          aria-label={googleSignedIn ? "Connected to Google" : "Sign in to Google"}
        >
          {isSigningIn ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : signInError ? (
            <AlertCircle className="w-3.5 h-3.5" />
          ) : googleSignedIn ? (
            <CheckCircle2 className="w-3.5 h-3.5" />
          ) : (
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="currentColor"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="currentColor"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="currentColor"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
          )}
          <span className="hidden sm:inline">
            {isSigningIn
              ? "Signing in..."
              : signInError
              ? signInError
              : googleSignedIn
              ? "Connected"
              : "Sign in"}
          </span>
        </button>
        <button
          className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-[var(--color-surface-hover)] transition-colors"
          aria-label="Search"
        >
          <Search className="w-5 h-5 text-[var(--color-text-secondary)]" />
        </button>
        <button
          className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-[var(--color-surface-hover)] transition-colors"
          aria-label="Help"
        >
          <HelpCircle className="w-5 h-5 text-[var(--color-text-secondary)]" />
        </button>
      </div>
    </header>
  );
}
