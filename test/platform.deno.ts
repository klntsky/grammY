import { assertEquals, stub } from "./deps.test.ts";

export function createStreamingSource() {
    return new Blob(["AB", "CD"]);
}

export function createResponse(
    bytes: Uint8Array<ArrayBuffer> | null,
    status = 200,
) {
    return new Response(bytes, { status });
}

export function stubFileOpen(bytes: Uint8Array) {
    return stub(Deno, "open", (path) => {
        assertEquals(path, "/tmp/file.txt");
        const readable = ReadableStream.from((function* () {
            yield bytes;
        })());
        return Promise.resolve({ readable } as Deno.FsFile);
    });
}

export function stubDownload(
    bytes: Uint8Array<ArrayBuffer> | null,
    status = 200,
    onSignal?: (signal: AbortSignal | undefined) => void,
) {
    return stub(globalThis, "fetch", (_url, init) => {
        onSignal?.(init?.signal ?? undefined);
        return Promise.resolve(createResponse(bytes, status));
    });
}
