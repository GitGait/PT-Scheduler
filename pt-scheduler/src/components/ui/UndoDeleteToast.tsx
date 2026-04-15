type UndoDeleteToastProps = {
    visible: boolean;
    onUndo: () => void;
};

export function UndoDeleteToast({ visible, onUndo }: UndoDeleteToastProps) {
    if (!visible) return null;
    return (
        <div
            role="status"
            aria-live="polite"
            className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 flex items-center gap-4 bg-gray-800 dark:bg-gray-700 text-white pl-4 pr-2 py-2 rounded shadow-lg text-sm"
        >
            <span>Appointment deleted</span>
            <button
                type="button"
                onClick={onUndo}
                className="font-semibold uppercase text-xs tracking-wide text-[var(--color-primary)] hover:text-white px-2 py-1 rounded"
            >
                Undo
            </button>
        </div>
    );
}
