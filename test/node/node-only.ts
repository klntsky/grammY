import { AbortController } from "abort-controller";
import type {
    AbortSignal,
    ApiCallFn,
    Context,
    Transformer,
} from "../../out/mod.js";
import { consumeSignal } from "./consumer.js";

export const noNativeAbortController: "AbortController" extends
    keyof typeof globalThis ? false : true = true;

export function consumeNodeSignals(
    context: Context,
    call: ApiCallFn,
    transform: Transformer,
) {
    const listeners = new Set<() => void>();
    const signal: AbortSignal = {
        aborted: false,
        addEventListener(_type, listener) {
            listeners.add(listener);
        },
        removeEventListener(_type, listener) {
            listeners.delete(listener);
        },
    };
    consumeSignal(signal, context, call, transform);
    consumeSignal(new AbortController().signal, context, call, transform);
}
