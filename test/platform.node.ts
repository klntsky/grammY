import fs from "fs";
import { Readable } from "stream";
import nodeFetch, { type RequestInit, Response } from "node-fetch";
import { assertEquals, stub } from "./deps.test.ts";

export function createStreamingSource() {
    return Readable.from([new Uint8Array([65, 66]), new Uint8Array([67, 68])]);
}

export function createResponse(bytes: Uint8Array | null, status = 200) {
    return new Response(bytes === null ? undefined : Readable.from([bytes]), {
        url: "https://grammy.dev",
        status,
    });
}

export function stubFileOpen(bytes: Uint8Array) {
    return stub(fs, "createReadStream", (path) => {
        assertEquals(path, "/tmp/file.txt");
        return Readable.from([bytes]) as fs.ReadStream;
    });
}

export function stubDownload(
    bytes: Uint8Array | null,
    status = 200,
    onSignal?: (
        signal: NonNullable<RequestInit["signal"]> | undefined,
    ) => void,
) {
    // node-fetch v2 exposes its default export on the CommonJS function object.
    return stub(nodeFetch, "default", (_url: unknown, init?: RequestInit) => {
        onSignal?.(init?.signal ?? undefined);
        return Promise.resolve(createResponse(bytes, status));
    });
}
