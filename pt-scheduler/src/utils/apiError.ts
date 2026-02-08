export interface ErrorPayload {
  error: string;
  code?: string;
  details?: string;
}

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status = 500, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export async function assertOk(
  res: Response,
  fallbackMessage: string
): Promise<void> {
  if (res.ok) return;

  let message = fallbackMessage;
  let code: string | undefined;

  try {
    const body = (await res.json()) as Partial<ErrorPayload>;
    if (typeof body.error === "string" && body.error.trim()) {
      message = body.error;
    }
    if (typeof body.code === "string" && body.code.trim()) {
      code = body.code;
    }
  } catch {
    // Keep fallback message.
  }

  throw new ApiError(message, res.status, code);
}

export function toErrorPayload(
  error: unknown,
  fallbackCode = "INTERNAL_ERROR"
): ErrorPayload {
  if (error instanceof ApiError) {
    return {
      error: error.message,
      code: error.code ?? fallbackCode
    };
  }

  if (error instanceof Error) {
    return {
      error: error.message,
      code: fallbackCode
    };
  }

  return {
    error: "Unexpected error",
    code: fallbackCode
  };
}

