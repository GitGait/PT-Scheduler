import { OptimizeResponse } from "../types";
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

