import type { Appointment } from "../types";

/** Sentinel patientId for personal (non-patient) events */
export const PERSONAL_PATIENT_ID = "__personal__";

export const PERSONAL_CATEGORIES = [
    "lunch",
    "meeting",
    "idt",
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
        bg: "#4caf50",
        gradient: "linear-gradient(135deg, #4caf50 0%, #388e3c 100%)",
    },
    {
        code: "meeting",
        label: "Meeting",
        bg: "#1565c0",
        gradient: "linear-gradient(135deg, #1565c0 0%, #0d47a1 100%)",
    },
    {
        code: "idt",
        label: "IDT Meeting",
        bg: "#00695c",
        gradient: "linear-gradient(135deg, #00695c 0%, #004d40 100%)",
    },
    {
        code: "errand",
        label: "Errand",
        bg: "#9e9d24",
        gradient: "linear-gradient(135deg, #9e9d24 0%, #827717 100%)",
    },
    {
        code: "personal",
        label: "Personal",
        bg: "#880e4f",
        gradient: "linear-gradient(135deg, #880e4f 0%, #6a0037 100%)",
    },
    {
        code: "admin",
        label: "Admin",
        bg: "#757575",
        gradient: "linear-gradient(135deg, #757575 0%, #616161 100%)",
    },
    {
        code: "other",
        label: "Other",
        bg: "#bcaaa4",
        gradient: "linear-gradient(135deg, #bcaaa4 0%, #a1887f 100%)",
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
