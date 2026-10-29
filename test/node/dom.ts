import { AbortController as PolyfillController } from "abort-controller";
import type { ApiCallFn, Context, Transformer } from "../../out/mod.js";
import { consumeSignal } from "./consumer.js";

export function consumeDomSignals(
    context: Context,
    call: ApiCallFn,
    transform: Transformer,
) {
    consumeSignal(new AbortController().signal, context, call, transform);
    consumeSignal(new PolyfillController().signal, context, call, transform);
}
