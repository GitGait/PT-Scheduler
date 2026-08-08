import { useState } from "react";
import { VISIT_TYPE_HUES, findVisitTypeHue } from "../../utils/visitTypeColors";

interface VisitTypeColorPickerProps {
    /** Current colour, `#rrggbb`. */
    value: string;
    onChange: (bg: string) => void;
    /** Completes the aria-labels: "Red for PT11" / "Red for the new type". */
    subject: string;
}

/**
 * Two-tier swatch picker: tap a hue family to apply its representative shade and
 * reveal the family's four steps, then optionally tap a step to refine. A base
 * colour stays one tap, which is what makes this usable one-handed on a phone.
 */
export function VisitTypeColorPicker({ value, onChange, subject }: VisitTypeColorPickerProps) {
    const [openHue, setOpenHue] = useState<string | null>(
        () => findVisitTypeHue(value)?.name ?? null
    );

    const selectedHue = findVisitTypeHue(value)?.name ?? null;
    const shades = VISIT_TYPE_HUES.find((hue) => hue.name === openHue)?.shades;
    const normalized = value.toLowerCase();

    return (
        <div>
            <div className="flex items-center gap-1.5 flex-wrap">
                {VISIT_TYPE_HUES.map((hue) => (
                    <button
                        key={hue.name}
                        type="button"
                        aria-label={`${hue.name} for ${subject}`}
                        onClick={() => {
                            setOpenHue(hue.name);
                            onChange(hue.shades[1]);
                        }}
                        className={`w-6 h-6 rounded-full ${
                            selectedHue === hue.name
                                ? "ring-2 ring-[var(--color-primary)]"
                                : "ring-1 ring-black/10"
                        }`}
                        style={{ backgroundColor: hue.shades[1] }}
                    />
                ))}
            </div>

            {/* Always rendered, so the custom input stays reachable when `value`
                sits outside the palette and no family is open. */}
            <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                {shades?.map((shade, index) => (
                    <button
                        key={shade}
                        type="button"
                        aria-label={`${openHue} shade ${index + 1} for ${subject}`}
                        onClick={() => onChange(shade)}
                        className={`w-6 h-6 rounded-full ${
                            normalized === shade
                                ? "ring-2 ring-[var(--color-primary)]"
                                : "ring-1 ring-black/10"
                        }`}
                        style={{ backgroundColor: shade }}
                    />
                ))}
                <input
                    type="color"
                    value={value}
                    aria-label={`Custom color for ${subject}`}
                    onChange={(e) => onChange(e.target.value.toLowerCase())}
                    className="w-8 h-8 p-0 bg-transparent border border-[var(--color-border)] rounded cursor-pointer"
                />
            </div>
        </div>
    );
}
