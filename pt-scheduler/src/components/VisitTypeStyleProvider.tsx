import { useEffect, useSyncExternalStore } from "react";
import { getVisitTypeCssText, subscribeVisitTypes } from "../utils/visitTypeColors";
import { useVisitTypeStore } from "../stores/visitTypeStore";

/**
 * Injects the `--vt-grad-*` / `--vt-bg-*` custom properties that colour every
 * appointment chip. Chips read them through `var()` with the compile-time
 * built-in as fallback, so the browser handles repainting and no consumer
 * needs to subscribe.
 */
export function VisitTypeStyleProvider() {
    const css = useSyncExternalStore(subscribeVisitTypes, getVisitTypeCssText, getVisitTypeCssText);
    const loadAll = useVisitTypeStore((state) => state.loadAll);

    useEffect(() => {
        void loadAll();
    }, [loadAll]);

    return <style>{css}</style>;
}
