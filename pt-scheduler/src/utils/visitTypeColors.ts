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
        code: "PT05",
        label: "ROC/Recert",
        bg: "#d81b60",
        gradient: "linear-gradient(135deg, #d81b60 0%, #ad1457 100%)",
    },
    {
        code: "PT06",
        label: "Recert",
        bg: "#ff6d00",
        gradient: "linear-gradient(135deg, #ff6d00 0%, #e65100 100%)",
    },
    {
        code: "PT10",
        label: "Supervisory Visit",
        bg: "#ffab00",
        gradient: "linear-gradient(135deg, #ffab00 0%, #ff8f00 100%)",
    },
    {
        code: "PT15",
        label: "Resumption of Care",
        bg: "#00bcd4",
        gradient: "linear-gradient(135deg, #00bcd4 0%, #0097a7 100%)",
    },
    {
        code: "NOMNC",
        label: "NOMNC",
        bg: "#795548",
        gradient: "linear-gradient(135deg, #795548 0%, #5d4037 100%)",
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
        bg: "#b0bec5",
        gradient: "linear-gradient(135deg, #b0bec5 0%, #90a4ae 100%)",
    },
];

const colorMap = new Map<VisitType, VisitTypeConfig>();
for (const config of VISIT_TYPE_CONFIGS) {
    colorMap.set(config.code, config);
}

const defaultConfig = VISIT_TYPE_CONFIGS.find((c) => c.code === null);
if (!defaultConfig) {
    throw new Error("VISIT_TYPE_CONFIGS must include a null (default) config entry");
}

export function getVisitTypeColor(visitType: VisitType | undefined): string {
    const config = colorMap.get(visitType ?? null);
    return config?.bg ?? defaultConfig.bg;
}

export function getVisitTypeGradient(visitType: VisitType | undefined): string {
    const config = colorMap.get(visitType ?? null);
    return config?.gradient ?? defaultConfig.gradient;
}

export function getVisitTypeLabel(visitType: VisitType | undefined): string {
    const config = colorMap.get(visitType ?? null);
    return config?.label ?? defaultConfig.label;
}

export function getVisitTypeConfig(visitType: VisitType | undefined): VisitTypeConfig {
    return colorMap.get(visitType ?? null) ?? defaultConfig;
}
