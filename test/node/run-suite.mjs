import { fork } from "child_process";
import { createRequire } from "module";
import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const directory = dirname(fileURLToPath(import.meta.url));
const suite = resolve(directory, "../../out/node-suite");

async function runFile(entry) {
    const fetch = require("node-fetch");
    const { TextEncoder, TextDecoder } = require("util");
    if (!globalThis.TextEncoder) globalThis.TextEncoder = TextEncoder;
    if (!globalThis.performance) {
        globalThis.performance = require("perf_hooks").performance;
    }
    process.on("unhandledRejection", (error) => {
        console.error("Unhandled rejection in upstream suite", error);
        process.exitCode = 1;
    });
    if (!globalThis.TextDecoder) globalThis.TextDecoder = TextDecoder;
    if (!Symbol.dispose) {
        Object.defineProperty(Symbol, "dispose", {
            value: Symbol.for("Symbol.dispose"),
        });
    }
    if (!Symbol.asyncDispose) {
        Object.defineProperty(Symbol, "asyncDispose", {
            value: Symbol.for("Symbol.asyncDispose"),
        });
    }
    if (!globalThis.fetch) globalThis.fetch = fetch;
    if (!globalThis.Response) globalThis.Response = fetch.Response;
    if (!globalThis.Request) globalThis.Request = fetch.Request;
    if (!globalThis.Headers) globalThis.Headers = fetch.Headers;
    if (!Response.json) {
        Response.json = (body, options) =>
            new Response(JSON.stringify(body), {
                ...options,
                headers: {
                    "content-type": "application/json",
                    ...(options && options.headers),
                },
            });
    }
    const registration = require(resolve(suite, "registration.cjs"));
    globalThis.Deno = { ...registration.Deno, args: [], noColor: true };
    require(resolve(suite, entry.bundle));
    const definitions = registration.testDefinitions;
    let tests = 0;
    let steps = 0;
    let failures = 0;
    const contexts = [];
    Deno.test = () => {
        throw new Error("Test registered after execution began");
    };

    function context(definition, parent) {
        const node = {
            name: definition.name,
            parent,
            origin: resolve(directory, "../..", entry.source),
            children: [],
            status: "pending",
            closed: false,
            error: undefined,
            step(...args) {
                if (node.closed) {
                    return Promise.reject(
                        new Error(
                            `Step registered after parent finished: ${node.name}`,
                        ),
                    );
                }
                const child = typeof args[0] === "string"
                    ? {
                        name: args[0],
                        ...(typeof args[1] === "object" ? args[1] : {}),
                        fn: args[2] || args[1],
                    }
                    : typeof args[0] === "function"
                    ? { name: args[0].name, fn: args[0] }
                    : { ...args[0], ...(args[1] ? { fn: args[1] } : {}) };
                const childContext = context(child, node);
                node.children.push(childContext);
                steps++;
                return execute(child, childContext);
            },
        };
        contexts.push(node);
        return node;
    }

    async function execute(definition, node) {
        try {
            if (definition.ignore || definition.only) {
                throw new Error("Ignored or focused tests are forbidden");
            }
            if (
                typeof definition.name !== "string" || !definition.name ||
                typeof definition.fn !== "function"
            ) {
                throw new Error("Invalid test or step definition");
            }
            await definition.fn(node);
            if (node.children.some((child) => child.status !== "passed")) {
                throw new Error(
                    "Child step failed or was not awaited to completion",
                );
            }
            node.status = "passed";
            return true;
        } catch (error) {
            node.status = "failed";
            node.error = error;
            failures++;
            const names = [];
            for (let current = node; current; current = current.parent) {
                names.unshift(current.name);
            }
            console.error(`FAIL ${entry.source} > ${names.join(" > ")}`);
            console.error(error);
            return false;
        } finally {
            node.closed = true;
        }
    }

    for (const definition of definitions) {
        tests++;
        await execute(definition, context(definition));
    }
    if (
        definitions.length !== tests ||
        contexts.some((node) => node.status === "pending")
    ) {
        throw new Error("Registered tests or steps remain unexecuted");
    }
    console.log(
        `${entry.source}: ${tests} tests, ${steps} steps, ${failures} failures`,
    );
    if (process.send) {
        process.send({ tests, steps, failures, source: entry.source });
    }
    if (failures) process.exitCode = 1;
}

async function main() {
    const manifest = JSON.parse(
        readFileSync(resolve(suite, "manifest.json"), "utf8"),
    );
    if (!Array.isArray(manifest) || !manifest.length) {
        throw new Error("Empty upstream suite manifest");
    }
    if (process.argv[2] === "--file") {
        const entry = manifest[Number(process.argv[3])];
        if (!entry) throw new Error("Unknown suite module");
        await runFile(entry);
        return;
    }
    let tests = 0;
    let steps = 0;
    let failures = 0;
    let modules = 0;
    async function runModule(index) {
        await new Promise((done) => {
            let result;
            const child = fork(fileURLToPath(import.meta.url), [
                "--file",
                String(index),
            ], {
                stdio: ["inherit", "inherit", "inherit", "ipc"],
            });
            const deadline = setTimeout(() => {
                console.error(`Timed out executing ${manifest[index].source}`);
                child.kill("SIGKILL");
            }, 120000);
            child.on("message", (message) => {
                if (result) {
                    console.error("Duplicate suite completion message");
                    failures++;
                }
                result = message;
            });
            child.on("error", (error) => {
                console.error(error);
                failures++;
            });
            child.on("exit", (code, signal) => {
                clearTimeout(deadline);
                if (!result || result.source !== manifest[index].source) {
                    console.error(
                        `Module did not complete: ${manifest[index].source}`,
                    );
                    failures++;
                } else {
                    modules++;
                    tests += result.tests;
                    steps += result.steps;
                    failures += result.failures;
                }
                if (
                    (code !== 0 || signal) && !(result && result.failures)
                ) failures++;
                done();
            });
        });
    }
    let next = 0;
    async function worker() {
        while (next < manifest.length) {
            const index = next++;
            await runModule(index);
        }
    }
    await Promise.all(Array.from(
        { length: Math.min(5, manifest.length) },
        () => worker(),
    ));
    console.log(
        `Node ${process.version}: ${modules}/${manifest.length} upstream modules, ${tests} tests, ${steps} steps, ${failures} failures`,
    );
    if (failures || modules !== manifest.length) process.exitCode = 1;
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
