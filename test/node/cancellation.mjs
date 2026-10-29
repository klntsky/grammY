import assert from "assert";
import http from "http";
import process from "process";
import abortController from "abort-controller";
import grammy from "../../out/mod.js";

const { Api, HttpError } = grammy;
const { AbortController: PolyfillController } = abortController;
const providers = [["polyfill", PolyfillController]];
if (typeof globalThis.AbortController === "function") {
    providers.push(["native", globalThis.AbortController]);
}

async function withinDeadline(promise) {
    let timer;
    try {
        return await Promise.race([
            promise,
            new Promise((_, reject) => {
                timer = setTimeout(() => {
                    reject(new Error("Local cancellation test timed out"));
                }, 5000);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

async function verifyCancellation(name, Controller, phase) {
    const sockets = new Set();
    let pendingRequests = 0;
    let onPending;
    const user = { id: 1, is_bot: true, first_name: "Local test" };
    const server = http.createServer((request, response) => {
        request.resume();
        if (request.url === "/pending") {
            pendingRequests++;
            if (onPending) onPending();
            return;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true, result: user }));
    });
    server.on("connection", (socket) => {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
    });
    try {
        await new Promise((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", resolve);
        });
        const root = `http://127.0.0.1:${server.address().port}`;
        const pending = new Api("local-test-token", {
            apiRoot: root,
            buildUrl: (root) => `${root}/pending`,
        });
        const healthy = new Api("local-test-token", { apiRoot: root });
        const controller = new Controller();
        let started;
        if (phase === "before") {
            controller.abort();
        } else {
            started = new Promise((resolve) => {
                onPending = resolve;
            });
        }
        const request = pending.getMe(controller.signal);
        const aborted = assert.rejects(request, (error) => {
            assert(error instanceof HttpError);
            assert.strictEqual(error.error.name, "AbortError");
            return true;
        });
        if (phase === "pending") {
            await withinDeadline(started);
            controller.abort();
        }
        await withinDeadline(aborted);
        assert.strictEqual(pendingRequests, phase === "pending" ? 1 : 0);
        assert.deepStrictEqual(await withinDeadline(healthy.getMe()), user);
        console.log(`${name} cancellation ${phase} request passed`);
    } finally {
        for (const socket of sockets) socket.destroy();
        await new Promise((resolve) => server.close(resolve));
    }
}

async function main() {
    for (const [name, Controller] of providers) {
        for (const phase of ["before", "pending"]) {
            await verifyCancellation(name, Controller, phase);
        }
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
