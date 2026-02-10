import type { VisitType } from "../types";

export interface VisitTypeConfig {
    code: VisitType;
    label: string;
    bg: string;
    gradient: string;
}

export const VISIT_TYPE_CONFIGS: VisitTypeConfig[] = [
    {
        code: "PT01",
        label: "PT Evaluation",
        bg: "#00897b",
        gradient: "linear-gradient(135deg, #00897b 0%, #00695c 100%)",
    },
    {
        code: "PT00",
        label: "OASIS Evaluation",
        bg: "#8e24aa",
        gradient: "linear-gradient(135deg, #8e24aa 0%, #6a1b9a 100%)",
    },
    {
        code: "PT02",
        label: "OASIS Recertification",
        bg: "#5c6bc0",
        gradient: "linear-gradient(135deg, #5c6bc0 0%, #3f51b5 100%)",
    },
    {
        code: "PT18",
        label: "OASIS Discharge",
        bg: "#fb8c00",
        gradient: "linear-gradient(135deg, #fb8c00 0%, #ef6c00 100%)",
    },
    {
        code: "PT19",
        label: "PT Discharge",
        bg: "#e53935",
        gradient: "linear-gradient(135deg, #e53935 0%, #c62828 100%)",
    },
    {
        code: "PT11",
        label: "Regular Visit",
        bg: "#039be5",
        gradient: "linear-gradient(135deg, #039be5 0%, #0288d1 100%)",
    },
    {
        code: "PT33",
        label: "PT Reassessment",
        bg: "#607d8b",
        gradient: "linear-gradient(135deg, #607d8b 0%, #455a64 100%)",
    },
    {
        code: null,
        label: "Unspecified",
        bg: "#78909c",
        gradient: "linear-gradient(135deg, #78909c 0%, #546e7a 100%)",
    },
];

const colorMap = new Map<string | null, VisitTypeConfig>();
for (const config of VISIT_TYPE_CONFIGS) {
    colorMap.set(config.code, config);
}

const defaultConfig = VISIT_TYPE_CONFIGS.find((c) => c.code === null)!;

export function getVisitTypeColor(visitType: VisitType | string | undefined): string {
    if (visitType === undefined || visitType === null) {
        return defaultConfig.bg;
    }
    const config = colorMap.get(visitType as string);
    return config?.bg ?? defaultConfig.bg;
}

export function getVisitTypeGradient(visitType: VisitType | string | undefined): string {
    if (visitType === undefined || visitType === null) {
        return defaultConfig.gradient;
    }
    const config = colorMap.get(visitType as string);
    return config?.gradient ?? defaultConfig.gradient;
}

export function getVisitTypeLabel(visitType: VisitType | string | undefined): string {
    if (visitType === undefined || visitType === null) {
        return defaultConfig.label;
    }
    const config = colorMap.get(visitType as string);
    return config?.label ?? visitType;
}

export function getVisitTypeConfig(visitType: VisitType | string | undefined): VisitTypeConfig {
    if (visitType === undefined || visitType === null) {
        return defaultConfig;
    }
    return colorMap.get(visitType as string) ?? defaultConfig;
}
