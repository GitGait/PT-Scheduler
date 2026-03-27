import type { OptimizeResponse } from "../types";
import { fetchJsonWithTimeout } from "./request";
import { optimizeResponseSchema, parseWithSchema } from "../utils/validation";

interface Location {
  id: string;
  lat: number;
  lng: number;
}

interface StartLocation {
  lat: number;
  lng: number;
}

export async function optimizeRoute(
  locations: Location[],
  startLocation: StartLocation
): Promise<OptimizeResponse> {
  // Validate coordinates before sending to API
  const allPoints = [...locations, { id: "start", ...startLocation }];
  for (const loc of allPoints) {
    if (loc.lat < -90 || loc.lat > 90 || loc.lng < -180 || loc.lng > 180) {
      throw new Error(`Invalid coordinates for location "${loc.id}": lat=${loc.lat}, lng=${loc.lng}`);
    }
  }

  const payload = await fetchJsonWithTimeout<unknown>(
    "/api/optimize",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locations, startLocation })
    },
    "Route optimization failed"
  );

  return parseWithSchema(optimizeResponseSchema, payload, "optimizeRoute");
}
