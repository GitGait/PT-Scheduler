/**
 * Environment variable helpers for serverless functions.
 * Fail fast with clear errors if required vars are missing.
 */

/**
 * Get a required environment variable or throw a clear error.
 * Use this for API keys and other required configuration.
 */
export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Get an optional environment variable with a default value.
 */
export function optionalEnv(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}
