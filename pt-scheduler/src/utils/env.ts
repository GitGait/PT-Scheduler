/**
 * Client-side environment variable validation
 * Only VITE_ prefixed variables are exposed to the client
 */

interface ClientEnv {
  VITE_GOOGLE_CLIENT_ID: string;
  VITE_GOOGLE_SHEETS_ID: string;
  VITE_GOOGLE_MAPS_API_KEY: string;
}

function getEnvVar(key: keyof ClientEnv): string {
  const value = import.meta.env[key];
  if (!value) {
    console.warn(`Environment variable ${key} is not set`);
    return '';
  }
  return value;
}

export const env = {
  googleClientId: getEnvVar('VITE_GOOGLE_CLIENT_ID'),
  googleSheetsId: getEnvVar('VITE_GOOGLE_SHEETS_ID'),
  googleMapsApiKey: getEnvVar('VITE_GOOGLE_MAPS_API_KEY'),
} as const;

/**
 * Check if all required environment variables are set
 */
export function validateEnv(): { valid: boolean; missing: string[] } {
  const required: (keyof ClientEnv)[] = [
    'VITE_GOOGLE_CLIENT_ID',
    'VITE_GOOGLE_SHEETS_ID',
    'VITE_GOOGLE_MAPS_API_KEY',
  ];

  const missing = required.filter(key => !import.meta.env[key]);

  return {
    valid: missing.length === 0,
    missing,
  };
}
