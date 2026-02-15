import type { Appointment } from "../types";

/** Sentinel patientId for personal (non-patient) events */
export const PERSONAL_PATIENT_ID = "__personal__";

export const PERSONAL_CATEGORIES = [
    "lunch",
    "meeting",
    "errand",
    "personal",
    "admin",
    "other",
] as const;

export type PersonalCategory = (typeof PERSONAL_CATEGORIES)[number];

export interface PersonalCategoryConfig {
    code: PersonalCategory;
    label: string;
    bg: string;
    gradient: string;
}

export const PERSONAL_CATEGORY_CONFIGS: PersonalCategoryConfig[] = [
    {
        code: "lunch",
        label: "Lunch",
        bg: "#ef6c00",
        gradient: "linear-gradient(135deg, #ef6c00 0%, #e65100 100%)",
    },
    {
        code: "meeting",
        label: "Meeting",
        bg: "#546e7a",
        gradient: "linear-gradient(135deg, #546e7a 0%, #37474f 100%)",
    },
    {
        code: "errand",
        label: "Errand",
        bg: "#00897b",
        gradient: "linear-gradient(135deg, #00897b 0%, #00695c 100%)",
    },
    {
        code: "personal",
        label: "Personal",
        bg: "#7b1fa2",
        gradient: "linear-gradient(135deg, #7b1fa2 0%, #6a1b9a 100%)",
    },
    {
        code: "admin",
        label: "Admin",
        bg: "#455a64",
        gradient: "linear-gradient(135deg, #455a64 0%, #37474f 100%)",
    },
    {
        code: "other",
        label: "Other",
        bg: "#78909c",
        gradient: "linear-gradient(135deg, #78909c 0%, #607d8b 100%)",
    },
];

const categoryMap = new Map<string, PersonalCategoryConfig>();
for (const config of PERSONAL_CATEGORY_CONFIGS) {
    categoryMap.set(config.code, config);
}

const defaultCategory = PERSONAL_CATEGORY_CONFIGS.find((c) => c.code === "other")!;

export function isPersonalEvent(appointment: Appointment): boolean {
    return appointment.patientId === PERSONAL_PATIENT_ID;
}

export function getPersonalCategoryGradient(category?: string): string {
    if (!category) return defaultCategory.gradient;
    return categoryMap.get(category)?.gradient ?? defaultCategory.gradient;
}

export function getPersonalCategoryLabel(category?: string): string {
    if (!category) return defaultCategory.label;
    return categoryMap.get(category)?.label ?? defaultCategory.label;
}

export function getPersonalCategoryConfig(category?: string): PersonalCategoryConfig {
    if (!category) return defaultCategory;
    return categoryMap.get(category) ?? defaultCategory;
}

export function parsePersonalCategory(value?: string): PersonalCategory {
    if (value && (PERSONAL_CATEGORIES as readonly string[]).includes(value)) {
        return value as PersonalCategory;
    }
    return "other";
}
