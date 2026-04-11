import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Appointment, Patient } from "../types";
import { geocodeAddress } from "../api/geocode";
import { getDistanceMatrix } from "../api/distance";
import {
    getHomeBase,
    calculateMilesBetweenCoordinates,
    estimateDriveMinutes,
} from "../utils/scheduling";
import { isPersonalEvent } from "../utils/personalEventColors";

export interface LegInfo {
    miles: number | null;
    minutes: number | null;
    fromHome: boolean;
    isRealDistance: boolean;
}

interface LocationDataResult {
    homeCoordinates: { lat: number; lng: number } | null;
    resolvedPatientCoordinates: Record<string, { lat: number; lng: number }>;
    getPatientCoordinates: (patientId: string) => { lat: number; lng: number } | null;
    resolvePatientCoordinatesForRouting: (patientId: string) => Promise<{ lat: number; lng: number } | null>;
    legInfoByAppointmentId: Record<string, LegInfo>;
    selectedDayEstimatedDriveMinutes: number;
    drivingDistances: Record<string, { miles: number; minutes: number }>;
    distanceError: string | null;
    retryDistanceFetch: () => void;
}

export function useLocationData(
    appointments: Appointment[],
    patientById: Map<string, Patient>,
    appointmentsByDay: Record<string, Appointment[]>,
    selectedDayAppointments: Appointment[],
): LocationDataResult {
    const [homeCoordinates, setHomeCoordinates] = useState<{ lat: number; lng: number } | null>(() => {
        const homeBase = getHomeBase();
        return homeBase.lat !== 0 && homeBase.lng !== 0 ? { lat: homeBase.lat, lng: homeBase.lng } : null;
    });
    const [resolvedPatientCoordinates, setResolvedPatientCoordinates] = useState<
        Record<string, { lat: number; lng: number }>
    >({});
    const patientGeocodeInFlightRef = useRef(new Set<string>());

    // Driving distances from Google Distance Matrix API (real road distances)
    const [drivingDistances, setDrivingDistances] = useState<
        Record<string, { miles: number; minutes: number }>
    >({});
    const [distanceError, setDistanceError] = useState<string | null>(null);
    const [distanceRetryCount, setDistanceRetryCount] = useState(0);

    useEffect(() => {
        let cancelled = false;

        const loadHomeCoordinates = async () => {
            const homeBase = getHomeBase();

            // If we already have valid coordinates from config, use them
            if (homeBase.lat !== 0 && homeBase.lng !== 0) {
                if (!cancelled) {
                    setHomeCoordinates({ lat: homeBase.lat, lng: homeBase.lng });
                }
                return;
            }

            // Otherwise try to geocode the address
            if (!homeBase.address) {
                return;
            }

            try {
                const geocoded = await geocodeAddress(homeBase.address);
                if (!cancelled) {
                    const hasValidCoordinates =
                        Number.isFinite(geocoded.lat) && Number.isFinite(geocoded.lng);
                    if (hasValidCoordinates) {
                        setHomeCoordinates({ lat: geocoded.lat, lng: geocoded.lng });
                    }
                }
            } catch {
                // Keep existing coordinates if geocoding fails
            }
        };

        void loadHomeCoordinates();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        let cancelled = false;
        const patientsNeedingCoordinates: Patient[] = [];
        const personalEventsNeedingCoordinates: Appointment[] = [];

        for (const appointment of appointments) {
            // Personal events with addresses: geocode using appointment.id as key
            if (isPersonalEvent(appointment)) {
                if (appointment.address?.trim() && !resolvedPatientCoordinates[appointment.id] && !patientGeocodeInFlightRef.current.has(appointment.id)) {
                    personalEventsNeedingCoordinates.push(appointment);
                }
                continue;
            }

            const patient = patientById.get(appointment.patientId);
            if (!patient?.address?.trim()) {
                continue;
            }
            if (patient.lat !== undefined && patient.lng !== undefined) {
                continue;
            }
            if (resolvedPatientCoordinates[patient.id]) {
                continue;
            }
            if (patientGeocodeInFlightRef.current.has(patient.id)) {
                continue;
            }
            patientsNeedingCoordinates.push(patient);
        }

        if (patientsNeedingCoordinates.length === 0 && personalEventsNeedingCoordinates.length === 0) {
            return;
        }

        const geocodeAll = async () => {
            const updates: Record<string, { lat: number; lng: number }> = {};

            for (const patient of patientsNeedingCoordinates) {
                patientGeocodeInFlightRef.current.add(patient.id);
            }
            for (const apt of personalEventsNeedingCoordinates) {
                patientGeocodeInFlightRef.current.add(apt.id);
            }

            try {
                await Promise.all([
                    ...patientsNeedingCoordinates.map(async (patient) => {
                        try {
                            const geocoded = await geocodeAddress(patient.address);
                            updates[patient.id] = { lat: geocoded.lat, lng: geocoded.lng };
                        } catch {
                            // Skip unresolved addresses
                        }
                    }),
                    ...personalEventsNeedingCoordinates.map(async (apt) => {
                        try {
                            const geocoded = await geocodeAddress(apt.address!);
                            updates[apt.id] = { lat: geocoded.lat, lng: geocoded.lng };
                        } catch {
                            // Skip unresolved addresses
                        }
                    }),
                ]);
            } finally {
                for (const patient of patientsNeedingCoordinates) {
                    patientGeocodeInFlightRef.current.delete(patient.id);
                }
                for (const apt of personalEventsNeedingCoordinates) {
                    patientGeocodeInFlightRef.current.delete(apt.id);
                }
            }

            if (!cancelled && Object.keys(updates).length > 0) {
                setResolvedPatientCoordinates((current) => ({ ...current, ...updates }));
            }
        };

        void geocodeAll();
        return () => {
            cancelled = true;
        };
    }, [appointments, patientById, resolvedPatientCoordinates]);

    // Fetch real driving distances from Google Distance Matrix API
    useEffect(() => {
        const abortController = new AbortController();

        const fetchDrivingDistances = async () => {
            setDistanceError(null);
            const allUpdates: Record<string, { miles: number; minutes: number }> = {};
            let lastError: string | null = null;

            for (const date of Object.keys(appointmentsByDay)) {
                if (abortController.signal.aborted) return;

                const dayAppointments = appointmentsByDay[date];
                if (dayAppointments.length === 0) continue;

                // Build locations array: optionally home + all appointments with coordinates
                const locations: Array<{ id: string; lat: number; lng: number }> = [];

                if (homeCoordinates) {
                    locations.push({ id: `home-${date}`, lat: homeCoordinates.lat, lng: homeCoordinates.lng });
                }

                for (const apt of dayAppointments) {
                    let coords: { lat: number; lng: number } | null = null;

                    if (isPersonalEvent(apt)) {
                        // Personal events: coordinates stored under appointment.id
                        coords = resolvedPatientCoordinates[apt.id] ?? null;
                    } else {
                        const patient = patientById.get(apt.patientId);
                        if (patient?.lat !== undefined && patient?.lng !== undefined) {
                            coords = { lat: patient.lat, lng: patient.lng };
                        } else if (resolvedPatientCoordinates[apt.patientId]) {
                            coords = resolvedPatientCoordinates[apt.patientId];
                        }
                    }

                    if (coords) {
                        locations.push({ id: apt.id, lat: coords.lat, lng: coords.lng });
                    }
                }

                // Need at least 2 locations to calculate distances
                if (locations.length < 2) continue;

                try {
                    const result = await getDistanceMatrix(locations);

                    if (abortController.signal.aborted) return;

                    for (const dist of result.distances) {
                        allUpdates[dist.destinationId] = {
                            miles: dist.distanceMiles,
                            minutes: dist.durationMinutes
                        };
                    }

                    if (result.distances.length === 0) {
                        console.warn('[DistanceMatrix] API returned 0 distances for', locations.length, 'locations on', date);
                    }
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    console.error(`[DistanceMatrix] Failed for ${date} (${locations.length} locations):`, message);
                    lastError = message;
                }
            }

            if (abortController.signal.aborted) return;

            if (Object.keys(allUpdates).length > 0) {
                setDrivingDistances(prev => ({ ...prev, ...allUpdates }));
            }

            if (lastError) {
                setDistanceError(lastError);
            }
        };

        // Debounce the fetch to avoid rapid re-fetching
        const timeoutId = setTimeout(() => {
            void fetchDrivingDistances();
        }, 500);

        return () => {
            clearTimeout(timeoutId);
            abortController.abort();
        };
    }, [appointmentsByDay, homeCoordinates, patientById, resolvedPatientCoordinates, distanceRetryCount]);

    const getPatientCoordinates = (patientId: string): { lat: number; lng: number } | null => {
        const patient = patientById.get(patientId);
        if (!patient) {
            return null;
        }
        if (patient.lat !== undefined && patient.lng !== undefined) {
            return { lat: patient.lat, lng: patient.lng };
        }
        return resolvedPatientCoordinates[patientId] ?? null;
    };

    const resolvePatientCoordinatesForRouting = useCallback(
        async (patientId: string): Promise<{ lat: number; lng: number } | null> => {
            const existing = getPatientCoordinates(patientId);
            if (existing) {
                return existing;
            }

            const patient = patientById.get(patientId);
            const address = patient?.address?.trim();
            if (!address) {
                return null;
            }

            try {
                const geocoded = await geocodeAddress(address);
                if (!Number.isFinite(geocoded.lat) || !Number.isFinite(geocoded.lng)) {
                    return null;
                }

                const coords = { lat: geocoded.lat, lng: geocoded.lng };
                setResolvedPatientCoordinates((current) => ({
                    ...current,
                    [patientId]: coords,
                }));
                return coords;
            } catch {
                return null;
            }
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [patientById, resolvedPatientCoordinates]
    );

    const legInfoByAppointmentId = useMemo(() => {
        const infoById: Record<
            string,
            { miles: number | null; minutes: number | null; fromHome: boolean; isRealDistance: boolean }
        > = {};

        for (const date of Object.keys(appointmentsByDay)) {
            const dayAppointments = appointmentsByDay[date];
            let previousCoords: { lat: number; lng: number } | null = homeCoordinates;

            for (let index = 0; index < dayAppointments.length; index += 1) {
                const appointment = dayAppointments[index];
                const isFirstOfDay = index === 0;
                const currentCoords = isPersonalEvent(appointment)
                    ? (resolvedPatientCoordinates[appointment.id] ?? null)
                    : getPatientCoordinates(appointment.patientId);

                // Check if we have real driving distance from the API
                const realDistance = drivingDistances[appointment.id];
                if (realDistance) {
                    infoById[appointment.id] = {
                        miles: realDistance.miles,
                        minutes: realDistance.minutes,
                        fromHome: isFirstOfDay,
                        isRealDistance: true,
                    };
                    if (currentCoords) {
                        previousCoords = currentCoords;
                    }
                    continue;
                }

                // Fall back to straight-line distance
                if (!currentCoords) {
                    infoById[appointment.id] = {
                        miles: null,
                        minutes: null,
                        fromHome: isFirstOfDay,
                        isRealDistance: false,
                    };
                    continue;
                }

                if (!previousCoords) {
                    infoById[appointment.id] = {
                        miles: null,
                        minutes: null,
                        fromHome: isFirstOfDay,
                        isRealDistance: false,
                    };
                    previousCoords = currentCoords;
                    continue;
                }

                const legMiles = calculateMilesBetweenCoordinates(previousCoords, currentCoords);
                const roundedMiles = Math.round(legMiles * 10) / 10;
                infoById[appointment.id] = {
                    miles: roundedMiles,
                    minutes: estimateDriveMinutes(roundedMiles),
                    fromHome: isFirstOfDay,
                    isRealDistance: false,
                };
                previousCoords = currentCoords;
            }
        }

        return infoById;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [appointmentsByDay, homeCoordinates, patientById, resolvedPatientCoordinates, drivingDistances]);

    const selectedDayEstimatedDriveMinutes = useMemo(() => {
        return selectedDayAppointments.reduce((total, appointment) => {
            const driveMinutes = legInfoByAppointmentId[appointment.id]?.minutes;
            return total + (driveMinutes ?? 0);
        }, 0);
    }, [selectedDayAppointments, legInfoByAppointmentId]);

    const retryDistanceFetch = useCallback(() => {
        setDrivingDistances({});
        setDistanceError(null);
        setDistanceRetryCount(c => c + 1);
    }, []);

    return {
        homeCoordinates,
        resolvedPatientCoordinates,
        getPatientCoordinates,
        resolvePatientCoordinatesForRouting,
        legInfoByAppointmentId,
        selectedDayEstimatedDriveMinutes,
        drivingDistances,
        distanceError,
        retryDistanceFetch,
    };
}
