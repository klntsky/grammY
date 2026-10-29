/**
 * Cancellation signal compatible with native and polyfilled abort signals.
 * Only the aborted state and abort listener subscription methods are required.
 */
export interface AbortSignal {
    readonly aborted: boolean;
    addEventListener(type: "abort", listener: () => void): void;
    removeEventListener(type: "abort", listener: () => void): void;
}
