import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Card, CardHeader } from "../ui/Card";
import { Button } from "../ui/Button";
import {
    useVisitTypeStore,
    isBuiltInVisitTypeCode,
    enqueueVisitTypeSync,
} from "../../stores/visitTypeStore";
import { visitTypeDB } from "../../db/operations";
import { VISIT_TYPES_SYNCED_EVENT, REQUEST_SYNC_EVENT } from "../../hooks/useSync";
import {
    validateNewVisitTypeCode,
    validateVisitTypeLabel,
    type NewVisitTypeCodeError,
} from "../../utils/visitTypeCodes";
import { VisitTypeEditorRow } from "./VisitTypeEditorRow";
import { VisitTypeColorPicker } from "./VisitTypeColorPicker";

const DEFAULT_NEW_COLOR = "#546e7a";

export function VisitTypeSettingsCard() {
    const { configs, stored, loadAll, save, setHidden, remove } = useVisitTypeStore();

    const [adding, setAdding] = useState(false);
    const [newCode, setNewCode] = useState("");
    const [newLabel, setNewLabel] = useState("");
    const [newColor, setNewColor] = useState(DEFAULT_NEW_COLOR);
    const [formError, setFormError] = useState<NewVisitTypeCodeError | { kind: "label"; message: string } | null>(null);
    const [unconfigured, setUnconfigured] = useState<{ code: string; count: number }[]>([]);
    const [pushing, setPushing] = useState(false);
    const [pushMessage, setPushMessage] = useState<string | null>(null);

    const storedCodes = useMemo(() => new Set(stored.map((d) => d.code)), [stored]);
    const registryCodes = useMemo(
        () => configs.map((c) => c.code).filter((c): c is string => c !== null),
        [configs]
    );
    const hiddenCodes = useMemo(
        () => configs.filter((c) => c.hidden).map((c) => c.code).filter((c): c is string => c !== null),
        [configs]
    );

    /**
     * Codes that exist on appointments but have no configuration — a PT26
     * scanned before it was set up. They keep their code and render gray.
     */
    const refreshUnconfigured = useCallback(async () => {
        try {
            const counts = await visitTypeDB.appointmentVisitTypeCounts();
            const known = new Set(registryCodes);
            const rows = [...counts.entries()]
                .filter(([code]) => !known.has(code))
                .map(([code, count]) => ({ code, count }))
                .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
            setUnconfigured(rows);
        } catch {
            setUnconfigured([]);
        }
    }, [registryCodes]);

    useEffect(() => {
        void loadAll();
    }, [loadAll]);

    useEffect(() => {
        void refreshUnconfigured();
    }, [refreshUnconfigured]);

    useEffect(() => {
        const handler = () => {
            void loadAll();
            void refreshUnconfigured();
        };
        window.addEventListener(VISIT_TYPES_SYNCED_EVENT, handler);
        window.addEventListener("pt-scheduler:appointments-synced", handler);
        return () => {
            window.removeEventListener(VISIT_TYPES_SYNCED_EVENT, handler);
            window.removeEventListener("pt-scheduler:appointments-synced", handler);
        };
    }, [loadAll, refreshUnconfigured]);

    const resetForm = () => {
        setAdding(false);
        setNewCode("");
        setNewLabel("");
        setNewColor(DEFAULT_NEW_COLOR);
        setFormError(null);
    };

    const startAdd = (prefillCode = "") => {
        setAdding(true);
        setNewCode(prefillCode);
        setNewLabel("");
        setNewColor(DEFAULT_NEW_COLOR);
        setFormError(null);
    };

    const handleAdd = async () => {
        const codeResult = validateNewVisitTypeCode(newCode, {
            existingCodes: registryCodes,
            hiddenCodes,
        });
        if (!codeResult.ok) {
            setFormError(codeResult.error);
            return;
        }

        const labelResult = validateVisitTypeLabel(newLabel);
        if (!labelResult.ok) {
            setFormError({ kind: "label", message: labelResult.message });
            return;
        }

        await save({ code: codeResult.code, label: labelResult.label, bg: newColor });
        resetForm();
        void refreshUnconfigured();
    };

    /**
     * Escape hatch: re-queue every stored visit type so the sheet tab gets
     * created/repopulated even if an earlier queue item was dropped.
     */
    const handlePushToSheet = async () => {
        setPushing(true);
        setPushMessage(null);
        try {
            for (const def of stored) {
                await enqueueVisitTypeSync("update", def.code);
            }
            setPushMessage(
                stored.length === 0
                    ? "Nothing to push — you haven't customized any visit types yet."
                    : `Queued ${stored.length} visit type${stored.length === 1 ? "" : "s"} for the sheet.`
            );
            window.dispatchEvent(new Event(REQUEST_SYNC_EVENT));
        } catch (err) {
            setPushMessage(err instanceof Error ? err.message : "Failed to queue visit types.");
        } finally {
            setPushing(false);
        }
    };

    const handleUnhide = async (code: string) => {
        await setHidden(code, false);
        resetForm();
    };

    const anyHidden = hiddenCodes.length > 0;

    return (
        <Card className="mb-4">
            <CardHeader
                title="Visit Types"
                subtitle="Rename, recolor, hide or add your own codes"
            />

            <div className="mt-2">
                {configs.map((config) => {
                    const code = config.code as string;
                    return (
                        <VisitTypeEditorRow
                            key={code}
                            config={config}
                            isBuiltIn={isBuiltInVisitTypeCode(code)}
                            hasOverride={storedCodes.has(code)}
                            onSave={(changes) => void save({ code, ...changes })}
                            onToggleHidden={() => void setHidden(code, !config.hidden)}
                            onRemove={() => void remove(code)}
                        />
                    );
                })}
            </div>

            {anyHidden && (
                <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
                    Hidden types are kept out of the visit type dropdown, but they still color
                    existing appointments.
                </p>
            )}

            {adding ? (
                <div className="mt-3 p-3 rounded-lg bg-[var(--color-surface-hover)]">
                    <div className="flex items-center gap-2 flex-wrap">
                        <input
                            value={newCode}
                            onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                            placeholder="PT26"
                            aria-label="New visit type code"
                            className="input-google w-24 font-mono text-sm"
                        />
                        <input
                            value={newLabel}
                            onChange={(e) => setNewLabel(e.target.value)}
                            placeholder="Description"
                            aria-label="New visit type description"
                            className="input-google flex-1 min-w-[8rem] text-sm"
                        />
                    </div>

                    {/* The picker owns the only custom-colour input on this form. */}
                    <div className="mt-2">
                        <VisitTypeColorPicker
                            value={newColor}
                            onChange={setNewColor}
                            subject="the new type"
                        />
                    </div>

                    {formError && (
                        <div className="mt-2 flex items-center gap-2 flex-wrap">
                            <span className="text-xs text-[var(--color-error,#e53935)]">
                                {formError.message}
                            </span>
                            {formError.kind === "builtInHidden" && (
                                <button
                                    type="button"
                                    onClick={() => void handleUnhide(formError.code)}
                                    className="text-xs px-2 py-1 rounded bg-[var(--color-primary)] text-white"
                                >
                                    Unhide {formError.code}
                                </button>
                            )}
                        </div>
                    )}

                    <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
                        A code can't be renamed after it's created — appointments, calendar events and
                        scan notes all reference it. To change one, delete it and add the new code.
                    </p>

                    <div className="mt-2 flex gap-2">
                        <Button onClick={() => void handleAdd()}>Add</Button>
                        <Button variant="secondary" onClick={resetForm}>
                            Cancel
                        </Button>
                    </div>
                </div>
            ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => startAdd()}>
                        <Plus className="w-4 h-4 mr-1" />
                        Add visit type
                    </Button>
                    <Button
                        variant="text"
                        disabled={pushing}
                        onClick={() => void handlePushToSheet()}
                    >
                        {pushing ? "Pushing…" : "Push my visit types to the sheet"}
                    </Button>
                </div>
            )}

            {pushMessage && (
                <p className="mt-2 text-xs text-[var(--color-text-secondary)]">{pushMessage}</p>
            )}

            {unconfigured.length > 0 && (
                <div className="mt-4 pt-3 border-t border-[var(--color-border)]">
                    <h4 className="text-sm font-medium text-[var(--color-text-primary)]">
                        Unconfigured types found
                    </h4>
                    <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                        These codes are on appointments but aren't set up yet, so they render gray.
                    </p>
                    <div className="mt-2 space-y-1.5">
                        {unconfigured.map(({ code, count }) => (
                            <div key={code} className="flex items-center gap-2">
                                <span className="font-mono text-sm text-[var(--color-text-primary)]">
                                    {code}
                                </span>
                                <span className="text-xs text-[var(--color-text-secondary)]">
                                    {count} appointment{count === 1 ? "" : "s"}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => startAdd(code)}
                                    className="ml-auto text-xs px-2 py-1 rounded bg-[var(--color-primary)] text-white"
                                >
                                    Add
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </Card>
    );
}
