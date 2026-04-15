import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Appointment, Patient } from "../types";
import { geocodeAddress } from "../api/geocode";
import { getDistanceMatrix } from "../api/distance";
import { distanceCacheDB, makeCoordKey } from "../db/operations";
import type { CachedDistance } from "../db/schema";
import {
    getHomeBase,
    calculateMilesBetweenCoordinates,
    estimateDriveMinutes,
} from "../utils/scheduling";
import { isPersonalEvent } from "../utils/personalEventColors";
import { usePatientStore } from "../stores/patientStore";

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
    selectedDate: string,
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
                            // Persist via the Zustand store so both IndexedDB AND the in-memory
                            // `patients` array get the new coords. Subsequent reloads short-circuit
                            // via the `patient.lat !== undefined` guard; within the current session
                            // the refreshed store prevents re-entry on state churn. Wrap so a DB
                            // failure doesn't mask a successful geocode.
                            try {
                                await usePatientStore.getState().update(patient.id, {
                                    lat: geocoded.lat,
                                    lng: geocoded.lng,
                                });
                            } catch (err) {
                                console.warn(
                                    "[Geocode] Failed to persist patient coords:",
                                    err instanceof Error ? err.message : err,
                                );
                            }
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

    // Memoized signature of just the selected day's appointments + their resolved
    // coordinates, rounded to 4 decimals to match makeCoordKey. Gates the fetch
    // effect so unrelated re-renders (other days' geocodes, map identity churn)
    // don't retrigger Distance Matrix calls.
    const selectedDaySignature = useMemo(() => {
        const dayAppts = appointmentsByDay[selectedDate] ?? [];
        return dayAppts
            .map((apt) => {
                let coords: { lat: number; lng: number } | null = null;
                if (isPersonalEvent(apt)) {
                    coords = resolvedPatientCoordinates[apt.id] ?? null;
                } else {
                    const patient = patientById.get(apt.patientId);
                    if (patient?.lat !== undefined && patient?.lng !== undefined) {
                        coords = { lat: patient.lat, lng: patient.lng };
                    } else {
                        coords = resolvedPatientCoordinates[apt.patientId] ?? null;
                    }
                }
                return coords
                    ? `${apt.id}:${coords.lat.toFixed(4)},${coords.lng.toFixed(4)}`
                    : `${apt.id}:none`;
            })
            .join("|");
    }, [appointmentsByDay, selectedDate, patientById, resolvedPatientCoordinates]);

    // Fetch real driving distances from Google Distance Matrix API.
    // Scoped to selectedDate only. Reads from distanceCacheDB first; on any
    // cache miss, calls the API with the full day's locations and re-caches
    // every leg in the response.
    useEffect(() => {
        const abortController = new AbortController();

        const fetchDrivingDistances = async () => {
            setDistanceError(null);
            const allUpdates: Record<string, { miles: number; minutes: number }> = {};
            let lastError: string | null = null;

            const dayAppointments = appointmentsByDay[selectedDate] ?? [];
            if (dayAppointments.length === 0) return;

            // Build locations array: optionally home + all appointments with coordinates
            const locations: Array<{ id: string; lat: number; lng: number }> = [];

            if (homeCoordinates) {
                locations.push({
                    id: `home-${selectedDate}`,
                    lat: homeCoordinates.lat,
                    lng: homeCoordinates.lng,
                });
            }

            for (const apt of dayAppointments) {
                let coords: { lat: number; lng: number } | null = null;

                if (isPersonalEvent(apt)) {
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
            if (locations.length < 2) return;

            // Build sequential leg keys and read-through the cache
            const legKeys: string[] = [];
            for (let i = 0; i < locations.length - 1; i++) {
                legKeys.push(makeCoordKey(locations[i], locations[i + 1]));
            }

            let cached = new Map<string, CachedDistance>();
            try {
                cached = await distanceCacheDB.getMany(legKeys);
            } catch (err) {
                console.warn(
                    '[DistanceMatrix] Cache read failed, falling through to API:',
                    err instanceof Error ? err.message : err,
                );
            }
            if (abortController.signal.aborted) return;

            let allHit = true;
            for (let i = 0; i < locations.length - 1; i++) {
                const hit = cached.get(legKeys[i]);
                if (hit) {
                    allUpdates[locations[i + 1].id] = {
                        miles: hit.distanceMiles,
                        minutes: hit.durationMinutes,
                    };
                } else {
                    allHit = false;
                }
            }

            if (!allHit) {
                try {
                    const result = await getDistanceMatrix(locations, abortController.signal);

                    if (abortController.signal.aborted) return;

                    const entriesToCache: Array<{
                        coordKey: string;
                        distanceMiles: number;
                        durationMinutes: number;
                        createdAt: Date;
                    }> = [];
                    const now = new Date();

                    for (const dist of result.distances) {
                        allUpdates[dist.destinationId] = {
                            miles: dist.distanceMiles,
                            minutes: dist.durationMinutes,
                        };

                        // Find this leg's position in the sequential chain and
                        // collect the matching cache entry. Legs are sequential
                        // so destinationId uniquely identifies the leg index.
                        const legIndex = locations.findIndex(
                            (loc, idx) => idx > 0 && loc.id === dist.destinationId,
                        );
                        if (legIndex > 0) {
                            const legKey = makeCoordKey(
                                locations[legIndex - 1],
                                locations[legIndex],
                            );
                            entriesToCache.push({
                                coordKey: legKey,
                                distanceMiles: dist.distanceMiles,
                                durationMinutes: dist.durationMinutes,
                                createdAt: now,
                            });
                        }
                    }

                    // Single bulkPut instead of N sequential IndexedDB writes.
                    // Wrap so a cache-write failure (quota, private mode, ITP
                    // eviction) does not mask the API's successful distances.
                    try {
                        await distanceCacheDB.putMany(entriesToCache);
                    } catch (err) {
                        console.warn(
                            '[DistanceMatrix] Cache write failed:',
                            err instanceof Error ? err.message : err,
                        );
                    }

                    if (result.distances.length === 0) {
                        console.warn(
                            '[DistanceMatrix] API returned 0 distances for',
                            locations.length,
                            'locations on',
                            selectedDate,
                        );
                    }
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    console.error(
                        `[DistanceMatrix] Failed for ${selectedDate} (${locations.length} locations):`,
                        message,
                    );
                    lastError = message;
                }
            }

            if (abortController.signal.aborted) return;

            if (Object.keys(allUpdates).length > 0) {
                setDrivingDistances((prev) => ({ ...prev, ...allUpdates }));
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
        // Deps intentionally exclude appointmentsByDay, patientById, and
        // resolvedPatientCoordinates: their contribution is captured by
        // selectedDaySignature. Direct deps would retrigger on unrelated churn.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedDaySignature, homeCoordinates, distanceRetryCount]);

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
            let homeLegAssigned = false;

            for (let index = 0; index < dayAppointments.length; index += 1) {
                const appointment = dayAppointments[index];
                const currentCoords = isPersonalEvent(appointment)
                    ? (resolvedPatientCoordinates[appointment.id] ?? null)
                    : getPatientCoordinates(appointment.patientId);

                // The home leg is the first appointment in this day's chain that actually
                // has resolved coordinates — only meaningful when a home base is configured.
                const legIsFromHome =
                    !homeLegAssigned && homeCoordinates !== null && currentCoords !== null;

                // Check if we have real driving distance from the API.
                // NOTE: drivingDistances is scoped to selectedDate only — the
                // fetch effect only populates legs for the currently-visible
                // day. Week-view rows for other days intentionally fall through
                // to straight-line estimates below; clicking a day warms the
                // cache for that day on its next visit.
                const realDistance = drivingDistances[appointment.id];
                if (realDistance) {
                    infoById[appointment.id] = {
                        miles: realDistance.miles,
                        minutes: realDistance.minutes,
                        fromHome: legIsFromHome,
                        isRealDistance: true,
                    };
                    if (legIsFromHome) homeLegAssigned = true;
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
                        fromHome: false,
                        isRealDistance: false,
                    };
                    continue;
                }

                if (!previousCoords) {
                    infoById[appointment.id] = {
                        miles: null,
                        minutes: null,
                        fromHome: false,
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
                    fromHome: legIsFromHome,
                    isRealDistance: false,
                };
                if (legIsFromHome) homeLegAssigned = true;
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
