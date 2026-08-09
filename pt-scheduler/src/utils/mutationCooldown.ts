// Timestamp of the most recent local mutation. Sync-triggered reloads are
// ignored for a short window afterwards so a pull landing mid-gesture can't
// clobber optimistic state. Module-level rather than page-local so undo
// (which writes through the stores, not through SchedulePage) can stamp it too.
let lastLocalMutationAt = 0;

export function markLocalMutation(): void {
    lastLocalMutationAt = Date.now();
}

export function isInMutationCooldown(ms: number): boolean {
    return Date.now() - lastLocalMutationAt < ms;
}
