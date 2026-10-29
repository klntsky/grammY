// deno-lint-ignore-file no-import-prefix
import {
    AbortController as PolyfillController,
    AbortSignal as PolyfillSignal,
} from "abort-controller";
import testAt from "npm:core-js-pure@3.47.0/actual/array/at.js";
import testReplaceAll from "npm:core-js-pure@3.47.0/actual/string/replace-all.js";
import testHasOwn from "npm:core-js-pure@3.47.0/actual/object/has-own.js";
import DOMException from "npm:core-js-pure@3.47.0/actual/dom-exception/index.js";
import testSetUnion from "npm:core-js-pure@3.47.0/actual/set/union.js";
export { DOMException, testAt, testHasOwn, testReplaceAll, testSetUnion };
export const AbortController = globalThis.AbortController ?? PolyfillController;
export const AbortSignal = globalThis.AbortSignal ?? PolyfillSignal;
