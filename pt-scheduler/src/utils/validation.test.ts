import { describe, expect, it } from "vitest";
import {
  ocrResponseSchema,
  extractedAppointmentSchema,
  optimizeResponseSchema,
  geocodeResponseSchema,
  aiMatchResponseSchema,
  parseWithSchema
} from "./validation";

describe("extractedAppointmentSchema", () => {
  describe("duration boundaries", () => {
    it("accepts minimum duration of 15 minutes", () => {
      const result = extractedAppointmentSchema.safeParse({
        rawName: "Test",
        date: "2026-02-07",
        time: "09:00",
        duration: 15
      });
      expect(result.success).toBe(true);
    });

    it("rejects duration of 14 minutes (below minimum)", () => {
      const result = extractedAppointmentSchema.safeParse({
        rawName: "Test",
        date: "2026-02-07",
        time: "09:00",
        duration: 14
      });
      expect(result.success).toBe(false);
    });

    it("accepts maximum duration of 240 minutes", () => {
      const result = extractedAppointmentSchema.safeParse({
        rawName: "Test",
        date: "2026-02-07",
        time: "09:00",
        duration: 240
      });
      expect(result.success).toBe(true);
    });

    it("rejects duration of 241 minutes (above maximum)", () => {
      const result = extractedAppointmentSchema.safeParse({
        rawName: "Test",
        date: "2026-02-07",
        time: "09:00",
        duration: 241
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-integer duration", () => {
      const result = extractedAppointmentSchema.safeParse({
        rawName: "Test",
        date: "2026-02-07",
        time: "09:00",
        duration: 60.5
      });
      expect(result.success).toBe(false);
    });
  });

  describe("date format", () => {
    it("accepts valid YYYY-MM-DD date", () => {
      const result = extractedAppointmentSchema.safeParse({
        rawName: "Test",
        date: "2026-12-31",
        time: "09:00",
        duration: 60
      });
      expect(result.success).toBe(true);
    });

    it("rejects MM-DD-YYYY format", () => {
      const result = extractedAppointmentSchema.safeParse({
        rawName: "Test",
        date: "12-31-2026",
        time: "09:00",
        duration: 60
      });
      expect(result.success).toBe(false);
    });

    it("rejects DD/MM/YYYY format", () => {
      const result = extractedAppointmentSchema.safeParse({
        rawName: "Test",
        date: "31/12/2026",
        time: "09:00",
        duration: 60
      });
      expect(result.success).toBe(false);
    });

    it("rejects date without leading zeros", () => {
      const result = extractedAppointmentSchema.safeParse({
        rawName: "Test",
        date: "2026-2-7",
        time: "09:00",
        duration: 60
      });
      expect(result.success).toBe(false);
    });
  });

  describe("time format", () => {
    it("accepts valid HH:mm time", () => {
      const result = extractedAppointmentSchema.safeParse({
        rawName: "Test",
        date: "2026-02-07",
        time: "14:30",
        duration: 60
      });
      expect(result.success).toBe(true);
    });

    it("accepts midnight as 00:00", () => {
      const result = extractedAppointmentSchema.safeParse({
        rawName: "Test",
        date: "2026-02-07",
        time: "00:00",
        duration: 60
      });
      expect(result.success).toBe(true);
    });

    it("accepts 23:59", () => {
      const result = extractedAppointmentSchema.safeParse({
        rawName: "Test",
        date: "2026-02-07",
        time: "23:59",
        duration: 60
      });
      expect(result.success).toBe(true);
    });

    it("rejects 12-hour format with AM/PM", () => {
      const result = extractedAppointmentSchema.safeParse({
        rawName: "Test",
        date: "2026-02-07",
        time: "2:30 PM",
        duration: 60
      });
      expect(result.success).toBe(false);
    });

    it("rejects time without leading zero", () => {
      const result = extractedAppointmentSchema.safeParse({
        rawName: "Test",
        date: "2026-02-07",
        time: "9:30",
        duration: 60
      });
      expect(result.success).toBe(false);
    });
  });

  describe("rawName", () => {
    it("accepts non-empty name", () => {
      const result = extractedAppointmentSchema.safeParse({
        rawName: "A",
        date: "2026-02-07",
        time: "09:00",
        duration: 60
      });
      expect(result.success).toBe(true);
    });

    it("rejects empty string", () => {
      const result = extractedAppointmentSchema.safeParse({
        rawName: "",
        date: "2026-02-07",
        time: "09:00",
        duration: 60
      });
      expect(result.success).toBe(false);
    });
  });

  describe("uncertain field", () => {
    it("is optional", () => {
      const result = extractedAppointmentSchema.safeParse({
        rawName: "Test",
        date: "2026-02-07",
        time: "09:00",
        duration: 60
      });
      expect(result.success).toBe(true);
      expect(result.data?.uncertain).toBeUndefined();
    });

    it("accepts true", () => {
      const result = extractedAppointmentSchema.safeParse({
        rawName: "Test",
        date: "2026-02-07",
        time: "09:00",
        duration: 60,
        uncertain: true
      });
      expect(result.success).toBe(true);
      expect(result.data?.uncertain).toBe(true);
    });

    it("accepts false", () => {
      const result = extractedAppointmentSchema.safeParse({
        rawName: "Test",
        date: "2026-02-07",
        time: "09:00",
        duration: 60,
        uncertain: false
      });
      expect(result.success).toBe(true);
      expect(result.data?.uncertain).toBe(false);
    });
  });
});

describe("ocrResponseSchema", () => {
  it("accepts valid OCR response", () => {
    const value = parseWithSchema(
      ocrResponseSchema,
      {
        appointments: [
          {
            rawName: "Robert Johnson",
            date: "2026-02-07",
            time: "09:30",
            duration: 60
          }
        ]
      },
      "ocr"
    );

    expect(value.appointments).toHaveLength(1);
    expect(value.appointments[0].rawName).toBe("Robert Johnson");
  });

  it("accepts empty appointments array", () => {
    const result = ocrResponseSchema.safeParse({ appointments: [] });
    expect(result.success).toBe(true);
    expect(result.data?.appointments).toEqual([]);
  });

  it("accepts multiple appointments", () => {
    const result = ocrResponseSchema.safeParse({
      appointments: [
        { rawName: "Patient A", date: "2026-02-07", time: "09:00", duration: 60 },
        { rawName: "Patient B", date: "2026-02-07", time: "10:00", duration: 45 },
        { rawName: "Patient C", date: "2026-02-07", time: "11:00", duration: 30 }
      ]
    });
    expect(result.success).toBe(true);
    expect(result.data?.appointments).toHaveLength(3);
  });

  it("rejects invalid OCR response shape", () => {
    expect(() =>
      parseWithSchema(
        ocrResponseSchema,
        {
          appointments: [{ rawName: "", date: "bad-date", time: "930", duration: 5 }]
        },
        "ocr"
      )
    ).toThrow(/validation failed/i);
  });

  it("rejects missing appointments field", () => {
    const result = ocrResponseSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("aiMatchResponseSchema", () => {
  it("accepts valid match with confidence", () => {
    const result = aiMatchResponseSchema.safeParse({
      matchedName: "Robert Johnson",
      confidence: 85
    });
    expect(result.success).toBe(true);
  });

  it("accepts null matchedName for no match", () => {
    const result = aiMatchResponseSchema.safeParse({
      matchedName: null,
      confidence: 0
    });
    expect(result.success).toBe(true);
  });

  it("accepts minimum confidence of 0", () => {
    const result = aiMatchResponseSchema.safeParse({
      matchedName: null,
      confidence: 0
    });
    expect(result.success).toBe(true);
  });

  it("accepts maximum confidence of 100", () => {
    const result = aiMatchResponseSchema.safeParse({
      matchedName: "Test",
      confidence: 100
    });
    expect(result.success).toBe(true);
  });

  it("rejects confidence below 0", () => {
    const result = aiMatchResponseSchema.safeParse({
      matchedName: "Test",
      confidence: -1
    });
    expect(result.success).toBe(false);
  });

  it("rejects confidence above 100", () => {
    const result = aiMatchResponseSchema.safeParse({
      matchedName: "Test",
      confidence: 101
    });
    expect(result.success).toBe(false);
  });
});

describe("geocodeResponseSchema", () => {
  it("accepts valid lat/lng", () => {
    const result = geocodeResponseSchema.safeParse({
      lat: 40.7128,
      lng: -74.006
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional formattedAddress", () => {
    const result = geocodeResponseSchema.safeParse({
      lat: 40.7128,
      lng: -74.006,
      formattedAddress: "New York, NY, USA"
    });
    expect(result.success).toBe(true);
    expect(result.data?.formattedAddress).toBe("New York, NY, USA");
  });

  it("omits formattedAddress when not provided", () => {
    const result = geocodeResponseSchema.safeParse({
      lat: 40.7128,
      lng: -74.006
    });
    expect(result.success).toBe(true);
    expect(result.data?.formattedAddress).toBeUndefined();
  });
});

describe("parseWithSchema", () => {
  it("returns validated data on success", () => {
    const result = parseWithSchema(
      geocodeResponseSchema,
      { lat: 0, lng: 0 },
      "geocode"
    );
    expect(result).toEqual({ lat: 0, lng: 0 });
  });

  it("includes context in error message", () => {
    expect(() =>
      parseWithSchema(geocodeResponseSchema, { lat: "invalid" }, "geocode")
    ).toThrow(/geocode validation failed/);
  });

  it("includes field path in error message", () => {
    expect(() =>
      parseWithSchema(geocodeResponseSchema, { lat: "invalid", lng: 0 }, "test")
    ).toThrow(/lat:/);
  });

  it("includes multiple errors", () => {
    expect(() =>
      parseWithSchema(
        geocodeResponseSchema,
        { lat: "invalid", lng: "invalid" },
        "test"
      )
    ).toThrow(/;/); // Multiple errors joined with semicolon
  });
});

