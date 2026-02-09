import { useEffect, useMemo, useState } from "react";
import { useAppointmentStore, usePatientStore } from "../stores";
import { Card, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { geocodeAddress } from "../api/geocode";
import { optimizeRoute } from "../api/optimize";
import type { Patient, Appointment } from "../types";
import {
    Phone,
    MapPin,
    Navigation,
    Clock,
    Car,
    CheckCircle,
    ChevronLeft,
    ChevronRight,
    Home,
} from "lucide-react";

import {
    getHomeBase,
    calculateMilesBetweenCoordinates,
    estimateDriveMinutes,
    toIsoDate,
    todayIso,
    parseLocalDate as parseIsoDate,
} from "../utils/scheduling";

const formatDate = (dateStr: string): string => {
    const date = parseIsoDate(dateStr);
    return date.toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
    });
};

const formatTime = (time: string): string => {
    const [hours, minutes] = time.split(":");
    const h = parseInt(hours, 10);
    const meridiem = h >= 12 ? "PM" : "AM";
    const h12 = ((h + 11) % 12) + 1;
    return `${h12}:${minutes} ${meridiem}`;
};

interface RouteStop {
    appointment: Appointment;
    patient: Patient | null;
    order: number;
    distanceMiles: number;
    driveTimeMinutes: number;
    fromLabel: string;
    coordinates: { lat: number; lng: number } | null;
}

export function RoutePage() {
    const [selectedDate, setSelectedDate] = useState(todayIso);
    const [isOptimizing, setIsOptimizing] = useState(false);
    const [routeStops, setRouteStops] = useState<RouteStop[]>([]);
    const homeBase = getHomeBase();
    const homeBaseAddress = homeBase.address || "Home Base (not configured)";
    const [homeCoordinates, setHomeCoordinates] = useState<{ lat: number; lng: number }>(() => {
        return { lat: homeBase.lat, lng: homeBase.lng };
    });
    const [resolvedCoordinates, setResolvedCoordinates] = useState<
        Record<string, { lat: number; lng: number }>
    >({});

    const { patients, loadAll: loadPatients } = usePatientStore();
    const { appointments, loadByRange, markComplete } = useAppointmentStore();

    const patientById = useMemo(() => {
        const map = new Map<string, Patient>();
        for (const p of patients) {
            map.set(p.id, p);
        }
        return map;
    }, [patients]);

    const dayAppointments = useMemo(() => {
        return appointments
            .filter((apt) => apt.date === selectedDate && apt.status !== "cancelled")
            .sort((a, b) => a.startTime.localeCompare(b.startTime));
    }, [appointments, selectedDate]);

    useEffect(() => {
        void loadPatients();
    }, [loadPatients]);

    useEffect(() => {
        void loadByRange(selectedDate, selectedDate);
    }, [loadByRange, selectedDate]);

    // Geocode home base if not already configured
    useEffect(() => {
        let cancelled = false;
        const loadHome = async () => {
            const homeBase = getHomeBase();

            // If we have valid coordinates, use them
            if (homeBase.lat !== 0 && homeBase.lng !== 0) {
                if (!cancelled) {
                    setHomeCoordinates({ lat: homeBase.lat, lng: homeBase.lng });
                }
                return;
            }

            // Try to geocode if we have an address
            if (homeBase.address) {
                try {
                    const result = await geocodeAddress(homeBase.address);
                    if (!cancelled && Number.isFinite(result.lat) && Number.isFinite(result.lng)) {
                        setHomeCoordinates({ lat: result.lat, lng: result.lng });
                    }
                } catch {
                    // Keep existing coordinates
                }
            }
        };
        void loadHome();
        return () => { cancelled = true; };
    }, []);

    // Geocode patient addresses
    useEffect(() => {
        let cancelled = false;
        const geocodePatients = async () => {
            const updates: Record<string, { lat: number; lng: number }> = {};
            for (const apt of dayAppointments) {
                const patient = patientById.get(apt.patientId);
                if (!patient?.address?.trim()) continue;
                if (patient.lat !== undefined && patient.lng !== undefined) continue;
                if (resolvedCoordinates[patient.id]) continue;

                try {
                    const result = await geocodeAddress(patient.address);
                    if (Number.isFinite(result.lat) && Number.isFinite(result.lng)) {
                        updates[patient.id] = { lat: result.lat, lng: result.lng };
                    }
                } catch {
                    // Skip
                }
            }
            if (!cancelled && Object.keys(updates).length > 0) {
                setResolvedCoordinates((prev) => ({ ...prev, ...updates }));
            }
        };
        void geocodePatients();
        return () => { cancelled = true; };
    }, [dayAppointments, patientById, resolvedCoordinates]);

    const getPatientCoordinates = (patientId: string): { lat: number; lng: number } | null => {
        const patient = patientById.get(patientId);
        if (!patient) return null;
        if (patient.lat !== undefined && patient.lng !== undefined) {
            return { lat: patient.lat, lng: patient.lng };
        }
        return resolvedCoordinates[patientId] ?? null;
    };

    // Build route stops
    useEffect(() => {
        const stops: RouteStop[] = [];
        let prevCoords = homeCoordinates;

        for (let i = 0; i < dayAppointments.length; i++) {
            const apt = dayAppointments[i];
            const patient = patientById.get(apt.patientId) ?? null;
            const coords = getPatientCoordinates(apt.patientId);

            let miles = 0;
            let fromLabel = i === 0 ? "From Home" : `From Stop ${i}`;

            if (coords && prevCoords) {
                miles = calculateMilesBetweenCoordinates(prevCoords, coords);
            }

            stops.push({
                appointment: apt,
                patient,
                order: i + 1,
                distanceMiles: Math.round(miles * 10) / 10,
                driveTimeMinutes: estimateDriveMinutes(miles),
                fromLabel,
                coordinates: coords,
            });

            if (coords) {
                prevCoords = coords;
            }
        }

        setRouteStops(stops);
    }, [dayAppointments, patientById, homeCoordinates, resolvedCoordinates]);

    const totalMiles = useMemo(() => {
        return routeStops.reduce((sum, s) => sum + s.distanceMiles, 0);
    }, [routeStops]);

    const totalDriveMinutes = useMemo(() => {
        return routeStops.reduce((sum, s) => sum + s.driveTimeMinutes, 0);
    }, [routeStops]);

    const totalAppointmentMinutes = useMemo(() => {
        return routeStops.reduce((sum, s) => sum + s.appointment.duration, 0);
    }, [routeStops]);

    const handleOptimize = async () => {
        if (dayAppointments.length < 2) return;

        setIsOptimizing(true);
        try {
            const locationsWithCoords = dayAppointments
                .map((apt) => {
                    const coords = getPatientCoordinates(apt.patientId);
                    if (!coords) return null;
                    return { id: apt.id, lat: coords.lat, lng: coords.lng };
                })
                .filter((loc): loc is { id: string; lat: number; lng: number } => loc !== null);

            if (locationsWithCoords.length < 2) {
                return;
            }

            const result = await optimizeRoute(locationsWithCoords, homeCoordinates);

            // Reorder appointments in store based on optimized order
            // For now, just rebuild stops in optimized order
            const orderMap = new Map(
                result.optimizedOrder.map((stop, idx) => [stop.locationId, idx])
            );

            const sortedAppointments = [...dayAppointments].sort((a, b) => {
                const orderA = orderMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
                const orderB = orderMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;
                return orderA - orderB;
            });

            // Rebuild stops
            const newStops: RouteStop[] = [];
            let prevCoords = homeCoordinates;

            for (let i = 0; i < sortedAppointments.length; i++) {
                const apt = sortedAppointments[i];
                const patient = patientById.get(apt.patientId) ?? null;
                const coords = getPatientCoordinates(apt.patientId);

                let miles = 0;
                if (coords && prevCoords) {
                    miles = calculateMilesBetweenCoordinates(prevCoords, coords);
                }

                newStops.push({
                    appointment: apt,
                    patient,
                    order: i + 1,
                    distanceMiles: Math.round(miles * 10) / 10,
                    driveTimeMinutes: estimateDriveMinutes(miles),
                    fromLabel: i === 0 ? "From Home" : `From Stop ${i}`,
                    coordinates: coords,
                });

                if (coords) {
                    prevCoords = coords;
                }
            }

            setRouteStops(newStops);
        } catch (err) {
            console.error("Route optimization failed:", err);
        } finally {
            setIsOptimizing(false);
        }
    };

    const handleMarkComplete = async (appointmentId: string) => {
        await markComplete(appointmentId);
    };

    const navigateDay = (days: number) => {
        const date = parseIsoDate(selectedDate);
        date.setDate(date.getDate() + days);
        setSelectedDate(toIsoDate(date));
    };

    const buildNavigateUrl = (address?: string) => {
        if (!address) return null;
        return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
    };

    const buildPhoneHref = (phone?: string) => {
        if (!phone) return null;
        return `tel:${phone.replace(/[^\d+]/g, "")}`;
    };

    return (
        <div className="pb-20 p-4 max-w-2xl mx-auto">
            {/* Header with date navigation */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => navigateDay(-1)}
                        className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[#f1f3f4] transition-colors"
                        aria-label="Previous day"
                    >
                        <ChevronLeft className="w-5 h-5 text-[#5f6368]" />
                    </button>
                    <h1 className="text-xl font-medium text-[#202124]">
                        {formatDate(selectedDate)}
                    </h1>
                    <button
                        onClick={() => navigateDay(1)}
                        className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[#f1f3f4] transition-colors"
                        aria-label="Next day"
                    >
                        <ChevronRight className="w-5 h-5 text-[#5f6368]" />
                    </button>
                </div>
                <div className="flex gap-2">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedDate(todayIso())}
                    >
                        Today
                    </Button>
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={handleOptimize}
                        disabled={isOptimizing || routeStops.length < 2}
                    >
                        {isOptimizing ? "Optimizing..." : "Optimize Route"}
                    </Button>
                </div>
            </div>

            {/* Summary */}
            {routeStops.length > 0 && (
                <div className="bg-[#f1f3f4] rounded-lg p-4 mb-4 grid grid-cols-4 gap-2 text-center">
                    <div>
                        <p className="text-2xl font-bold text-[#1a73e8]">{routeStops.length}</p>
                        <p className="text-xs text-[#5f6368]">Stops</p>
                    </div>
                    <div>
                        <p className="text-2xl font-bold text-[#1a73e8]">{totalMiles.toFixed(1)}</p>
                        <p className="text-xs text-[#5f6368]">Miles</p>
                    </div>
                    <div>
                        <p className="text-2xl font-bold text-[#1a73e8]">{totalDriveMinutes}</p>
                        <p className="text-xs text-[#5f6368]">Drive (min)</p>
                    </div>
                    <div>
                        <p className="text-2xl font-bold text-[#1a73e8]">{totalAppointmentMinutes}</p>
                        <p className="text-xs text-[#5f6368]">Appt (min)</p>
                    </div>
                </div>
            )}

            {/* Home Base */}
            <Card className="mb-3 border-l-4 border-l-[#34a853]">
                <div className="flex items-center gap-3">
                    <div className="flex-shrink-0 w-10 h-10 bg-[#34a853] rounded-full flex items-center justify-center text-white">
                        <Home className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                        <p className="font-medium text-[#202124]">Start: Home Base</p>
                        <p className="text-sm text-[#5f6368]">{homeBaseAddress}</p>
                    </div>
                </div>
            </Card>

            {/* Route Stops */}
            <div className="space-y-3">
                {routeStops.length === 0 ? (
                    <div className="text-center py-12">
                        <Car className="w-12 h-12 mx-auto text-[#dadce0] mb-4" />
                        <p className="text-[#5f6368] mb-2">No appointments for {formatDate(selectedDate)}</p>
                        <p className="text-sm text-[#5f6368]">Add appointments from the Schedule page</p>
                    </div>
                ) : (
                    routeStops.map((stop) => {
                        const isCompleted = stop.appointment.status === "completed";
                        const navUrl = buildNavigateUrl(stop.patient?.address);
                        const phoneHref = buildPhoneHref(stop.patient?.phone);

                        return (
                            <Card
                                key={stop.appointment.id}
                                className={`${isCompleted ? "opacity-60" : ""}`}
                            >
                                {/* Drive time indicator */}
                                {stop.driveTimeMinutes > 0 && (
                                    <div className="flex items-center gap-2 text-sm text-[#5f6368] mb-2 pb-2 border-b border-[#f1f3f4]">
                                        <Car className="w-4 h-4" />
                                        <span>{stop.fromLabel}: {stop.distanceMiles} mi ({stop.driveTimeMinutes} min)</span>
                                    </div>
                                )}

                                <div className="flex items-start gap-3">
                                    <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-white font-medium ${
                                        isCompleted ? "bg-[#34a853]" : "bg-[#1a73e8]"
                                    }`}>
                                        {isCompleted ? <CheckCircle className="w-5 h-5" /> : stop.order}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <p className="font-medium text-[#202124] truncate">
                                                    {stop.patient?.fullName ?? "Unknown Patient"}
                                                </p>
                                                <div className="flex items-center gap-2 text-sm text-[#5f6368]">
                                                    <Clock className="w-4 h-4" />
                                                    <span>
                                                        {formatTime(stop.appointment.startTime)} ({stop.appointment.duration} min)
                                                    </span>
                                                </div>
                                            </div>
                                            {!isCompleted && (
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    onClick={() => handleMarkComplete(stop.appointment.id)}
                                                >
                                                    <CheckCircle className="w-4 h-4" />
                                                </Button>
                                            )}
                                        </div>

                                        {/* Address */}
                                        {stop.patient?.address && (
                                            <div className="flex items-start gap-2 mt-2 text-sm text-[#5f6368]">
                                                <MapPin className="w-4 h-4 flex-shrink-0 mt-0.5" />
                                                <span className="break-words">{stop.patient.address}</span>
                                            </div>
                                        )}

                                        {/* Action buttons */}
                                        <div className="flex gap-2 mt-3">
                                            {navUrl && (
                                                <a
                                                    href={navUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="inline-block"
                                                >
                                                    <Button size="sm" variant="primary">
                                                        <Navigation className="w-4 h-4 mr-1" />
                                                        Navigate
                                                    </Button>
                                                </a>
                                            )}
                                            {phoneHref && (
                                                <a href={phoneHref} className="inline-block">
                                                    <Button size="sm" variant="secondary">
                                                        <Phone className="w-4 h-4 mr-1" />
                                                        Call
                                                    </Button>
                                                </a>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </Card>
                        );
                    })
                )}
            </div>
        </div>
    );
}
