import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "./ui/Button";
import { X } from "lucide-react";
import type { Appointment, Patient } from "../types";
import { getHomeBase, buildGoogleMapsDirectionsFromCoordinatesHref } from "../utils/scheduling";
import { isPersonalEvent } from "../utils/personalEventColors";
import "leaflet/dist/leaflet.css";

interface DayMapPoint {
    id: string;
    label: string;
    lat: number;
    lng: number;
    isHome: boolean;
}

interface DayMapModalProps {
    isOpen: boolean;
    onClose: () => void;
    selectedDate: string;
    selectedDayAppointments: Appointment[];
    homeCoordinates: { lat: number; lng: number } | null;
    getPatient: (id: string) => Patient | undefined;
    resolvePatientCoordinatesForRouting: (id: string) => Promise<{ lat: number; lng: number } | null>;
}

export function DayMapModal({
    isOpen,
    onClose,
    selectedDate,
    selectedDayAppointments,
    homeCoordinates,
    getPatient,
    resolvePatientCoordinatesForRouting,
}: DayMapModalProps) {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [infoMessage, setInfoMessage] = useState<string | null>(null);
    const [points, setPoints] = useState<DayMapPoint[]>([]);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapInstanceRef = useRef<import("leaflet").Map | null>(null);
    const layerRef = useRef<import("leaflet").LayerGroup | null>(null);

    // Load map data when modal opens — same logic as handleOpenDayMap
    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;

        const loadMapData = async () => {
            const activeDayAppointments = selectedDayAppointments.filter(
                (appointment) => appointment.status !== "cancelled"
            );

            if (activeDayAppointments.length === 0) {
                setError("No appointments for this day.");
                setInfoMessage(null);
                setPoints([]);
                return;
            }

            setError(null);
            setInfoMessage(null);
            setIsLoading(true);

            try {
                const mapPoints: DayMapPoint[] = [];
                const homeBase = getHomeBase();
                const home = homeCoordinates ?? { lat: homeBase.lat, lng: homeBase.lng };
                const hasValidHome = !(home.lat === 0 && home.lng === 0);
                if (hasValidHome) {
                    mapPoints.push({
                        id: "home",
                        label: "Home",
                        lat: home.lat,
                        lng: home.lng,
                        isHome: true,
                    });
                }

                const seenPatientIds = new Set<string>();
                let unresolvedCount = 0;

                for (const appointment of activeDayAppointments) {
                    if (isPersonalEvent(appointment)) {
                        continue;
                    }
                    if (seenPatientIds.has(appointment.patientId)) {
                        continue;
                    }
                    seenPatientIds.add(appointment.patientId);

                    const patient = getPatient(appointment.patientId);
                    const coords = await resolvePatientCoordinatesForRouting(appointment.patientId);
                    if (!coords) {
                        unresolvedCount += 1;
                        continue;
                    }

                    mapPoints.push({
                        id: appointment.id,
                        label: `${appointment.startTime} ${patient?.fullName ?? "Unknown Patient"}`,
                        lat: coords.lat,
                        lng: coords.lng,
                        isHome: false,
                    });
                }

                if (cancelled) return;

                const hasPatientPoints = mapPoints.some((p) => !p.isHome);
                if (!hasPatientPoints) {
                    setError("Could not map any patient addresses for this day.");
                    setInfoMessage(null);
                    setPoints(mapPoints);
                    return;
                }

                const warnings: string[] = [];
                if (!hasValidHome) {
                    warnings.push("Home address not set — home marker omitted.");
                }
                if (unresolvedCount > 0) {
                    warnings.push(
                        `${unresolvedCount} patient${unresolvedCount === 1 ? "" : "s"} could not be mapped (missing/invalid address).`
                    );
                }
                setInfoMessage(warnings.length > 0 ? warnings.join(" ") : null);
                setPoints(mapPoints);
            } catch (err) {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : "Failed to build day map.");
                    setPoints([]);
                }
            } finally {
                if (!cancelled) {
                    setIsLoading(false);
                }
            }
        };

        void loadMapData();
        return () => {
            cancelled = true;
        };
    }, [isOpen, selectedDayAppointments, homeCoordinates, getPatient, resolvePatientCoordinatesForRouting]);

    // Directions href
    const directionsHref = useMemo(() => {
        const homePoint = points.find((point) => point.isHome);
        if (!homePoint) {
            return null;
        }

        const patientStops = points
            .filter((point) => !point.isHome)
            .map((point) => ({ lat: point.lat, lng: point.lng }));
        return buildGoogleMapsDirectionsFromCoordinatesHref(
            { lat: homePoint.lat, lng: homePoint.lng },
            patientStops
        );
    }, [points]);

    // Leaflet render effect
    useEffect(() => {
        let cancelled = false;

        const renderMap = async () => {
            if (!isOpen || !containerRef.current || points.length === 0) {
                return;
            }

            const L = await import("leaflet");
            if (cancelled || !containerRef.current) {
                return;
            }

            if (!mapInstanceRef.current) {
                mapInstanceRef.current = L.map(containerRef.current, {
                    zoomControl: true,
                    attributionControl: true,
                });

                L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
                    maxZoom: 19,
                    attribution: "&copy; OpenStreetMap contributors",
                }).addTo(mapInstanceRef.current);

                layerRef.current = L.layerGroup().addTo(mapInstanceRef.current);
            }

            const map = mapInstanceRef.current;
            const layer = layerRef.current;
            if (!map || !layer) {
                return;
            }

            layer.clearLayers();
            const bounds = L.latLngBounds([]);

            const computedStyle = getComputedStyle(document.documentElement);
            const mapRedColor = computedStyle.getPropertyValue("--color-event-red").trim();
            const mapBlueColor = computedStyle.getPropertyValue("--color-primary").trim();

            for (let index = 0; index < points.length; index += 1) {
                const point = points[index];
                const color = point.isHome ? mapRedColor : mapBlueColor;
                const marker = L.circleMarker([point.lat, point.lng], {
                    radius: point.isHome ? 9 : 7,
                    color,
                    weight: 2,
                    fillColor: color,
                    fillOpacity: 0.9,
                });
                marker.bindTooltip(
                    point.isHome ? "Home" : `${index}. ${point.label}`,
                    {
                        direction: "top",
                        offset: [0, -4],
                    }
                );
                marker.addTo(layer);
                bounds.extend([point.lat, point.lng]);
            }

            if (points.length > 1) {
                const routeCoordinates = points.map((point) => [point.lat, point.lng]) as [
                    number,
                    number
                ][];
                L.polyline(routeCoordinates, {
                    color: mapBlueColor,
                    opacity: 0.55,
                    weight: 3,
                    dashArray: "6,6",
                }).addTo(layer);
            }

            if (bounds.isValid()) {
                map.fitBounds(bounds.pad(0.2), { maxZoom: 14 });
            }

            window.setTimeout(() => {
                map.invalidateSize();
            }, 0);
        };

        void renderMap();

        return () => {
            cancelled = true;
        };
    }, [isOpen, points]);

    // Cleanup Leaflet on unmount
    useEffect(() => {
        return () => {
            mapInstanceRef.current?.remove();
            mapInstanceRef.current = null;
            layerRef.current = null;
        };
    }, []);

    const handleClose = () => {
        if (mapInstanceRef.current) {
            mapInstanceRef.current.remove();
            mapInstanceRef.current = null;
        }
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/35"
            onClick={handleClose}
        >
            <div
                className="bg-[var(--color-surface)] rounded-lg shadow-2xl w-full max-w-4xl mx-4 max-h-[90vh] overflow-hidden animate-slide-in"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
                    <div>
                        <h2 className="text-base font-medium text-[var(--color-text-primary)]">Day Map</h2>
                        <p className="text-xs text-[var(--color-text-secondary)]">{selectedDate}</p>
                    </div>
                    <button
                        onClick={handleClose}
                        className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-[var(--color-surface-hover)]"
                        aria-label="Close day map"
                    >
                        <X className="w-5 h-5 text-[var(--color-text-secondary)]" />
                    </button>
                </div>

                <div className="p-4 space-y-3">
                    {isLoading && (
                        <p className="text-sm text-[var(--color-text-secondary)]">Building map...</p>
                    )}

                    {error && (
                        <p className="text-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded px-3 py-2">
                            {error}
                        </p>
                    )}

                    {infoMessage && (
                        <p className="text-sm text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded px-3 py-2">
                            {infoMessage}
                        </p>
                    )}

                    <div
                        ref={containerRef}
                        className="w-full h-[52vh] min-h-[320px] rounded border border-[var(--color-border)]"
                    />
                </div>

                <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--color-border)]">
                    <Button
                        variant="secondary"
                        onClick={() => {
                            if (directionsHref) {
                                window.open(directionsHref, "_blank");
                            }
                        }}
                        disabled={!directionsHref || isLoading}
                    >
                        Open in Google Maps
                    </Button>
                    <Button variant="ghost" onClick={handleClose}>
                        Close
                    </Button>
                </div>
            </div>
        </div>
    );
}
