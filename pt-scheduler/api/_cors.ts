import type { VercelRequest, VercelResponse } from "@vercel/node";

const ALLOWED_ORIGINS = [
  "http://localhost:5173", // Vite dev server
  "http://localhost:4173", // Vite preview
  process.env.PRODUCTION_URL // e.g. "https://pt-scheduler.vercel.app"
].filter(Boolean) as string[];

/**
 * Handle CORS headers for API endpoints.
 * Call at the top of every handler: `if (cors(req, res)) return;`
 *
 * @returns true if this was a preflight request (handler should return early)
 */
export function cors(req: VercelRequest, res: VercelResponse): boolean {
  const origin = req.headers.origin ?? "";

  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Access-Control-Allow-Methods", "POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }

  return false;
}

/**
 * Validate that the request method is POST.
 * @returns true if method is invalid (handler should return early)
 */
export function requirePost(req: VercelRequest, res: VercelResponse): boolean {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed", code: "METHOD_NOT_ALLOWED" });
    return true;
  }
  return false;
}
