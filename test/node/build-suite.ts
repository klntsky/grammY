// deno-lint-ignore-file no-import-prefix
import * as esbuild from "npm:esbuild@0.25.12";
import "npm:@deno/shim-deno-test@0.5.0";
import ts from "npm:typescript@5.9.3";
import "./test-compatibility.ts";
import { fromFileUrl, relative, resolve, toFileUrl } from "jsr:@std/path@1";

const root = fromFileUrl(new URL("../../", import.meta.url));
const destination = resolve(root, "out/node-suite");
const portableMethods: Record<string, string> = {
    at: "testAt",
    replaceAll: "testReplaceAll",
    union: "testSetUnion",
};
const files: string[] = [];
async function discover(directory: string) {
    for await (const entry of Deno.readDir(directory)) {
        const path = resolve(directory, entry.name);
        if (entry.isDirectory) await discover(path);
        else if (entry.isFile && entry.name.endsWith(".test.ts")) {
            files.push(path);
        }
    }
}
await discover(resolve(root, "test"));
files.sort();
if (!files.length) throw new Error("No upstream test modules discovered");
await Deno.mkdir(destination, { recursive: true });
const entry = await Deno.makeTempFile({ suffix: ".ts" });
try {
    const graphFiles = [...files, resolve(root, "test/platform.node.ts")];
    await Deno.writeTextFile(
        entry,
        graphFiles.map((file) =>
            `import ${JSON.stringify(toFileUrl(file).href)};`
        ).join("\n"),
    );
    const info = await new Deno.Command(Deno.execPath(), {
        args: ["info", "--json", entry],
        stdout: "piped",
        stderr: "inherit",
    }).output();
    if (!info.success) {
        throw new Error("Cannot resolve upstream test dependency graph");
    }
    const graph = JSON.parse(new TextDecoder().decode(info.stdout));
    const modules = new Map<
        string,
        {
            local?: string;
            dependencies?: {
                specifier: string;
                code?: { specifier: string };
            }[];
        }
    >(
        graph.modules.map((
            module: { specifier: string },
        ) => [module.specifier, module]),
    );
    const redirects = graph.redirects ?? {};
    const canonical = (specifier: string): string => {
        while (redirects[specifier]) specifier = redirects[specifier];
        return specifier;
    };
    const shimPath = import.meta.resolve("npm:@deno/shim-deno-test@0.5.0");
    const shimModule = await Deno.realPath(fromFileUrl(shimPath));
    await esbuild.build({
        entryPoints: [shimModule],
        outfile: resolve(destination, "registration.cjs"),
        bundle: true,
        platform: "node",
        target: "node12.20",
        format: "cjs",
    });
    for (const file of files) {
        const name = relative(resolve(root, "test"), file).replaceAll("/", "_")
            .replace(/\.ts$/, ".cjs");
        await esbuild.build({
            entryPoints: [toFileUrl(file).href],
            outfile: resolve(destination, name),
            bundle: true,
            platform: "node",
            target: "node12.20",
            format: "cjs",
            sourcemap: "inline",
            inject: [
                resolve(root, "test/node/test-promise.ts"),
                resolve(root, "test/node/test-compatibility.ts"),
            ],
            define: {
                "Promise.withResolvers": "testWithResolvers",
            },
            plugins: [{
                name: "upstream-deno-tests",
                setup(build) {
                    build.onResolve({ filter: /.*/ }, (args) => {
                        if (args.path.startsWith("npm:")) {
                            return {
                                path: fromFileUrl(
                                    import.meta.resolve(args.path),
                                ),
                            };
                        }
                        if (
                            args.path.startsWith("node:") ||
                            ["fs", "stream", "node-fetch", "abort-controller"]
                                .includes(args.path)
                        ) {
                            return {
                                path: args.path.replace(/^node:/, ""),
                                external: true,
                            };
                        }
                        if (args.namespace === "file" && args.importer) return;
                        if (
                            args.path ===
                                resolve(root, "test/node/test-promise.ts") ||
                            args.path ===
                                resolve(root, "test/node/test-compatibility.ts")
                        ) return;
                        const importer = modules.get(canonical(args.importer));
                        let url = importer?.dependencies?.find((dep) =>
                            dep.specifier === args.path
                        )?.code?.specifier ?? args.path;
                        url = canonical(url);
                        if (
                            url.startsWith(
                                toFileUrl(resolve(root, "src") + "/").href,
                            )
                        ) {
                            const generated = resolve(
                                root,
                                "out",
                                relative(
                                    resolve(root, "src"),
                                    fromFileUrl(url),
                                ),
                            ).replace(/\.ts$/, ".js").replace(
                                /\.deno\.js$/,
                                ".node.js",
                            );
                            return { path: generated, external: true };
                        }
                        if (
                            url ===
                                toFileUrl(
                                    resolve(root, "test/platform.deno.ts"),
                                ).href
                        ) {
                            return {
                                path: toFileUrl(
                                    resolve(root, "test/platform.node.ts"),
                                ).href,
                                namespace: "deno",
                            };
                        }
                        if (modules.has(url)) {
                            return { path: url, namespace: "deno" };
                        }
                        throw new Error(
                            `Unresolved test import ${args.path} from ${args.importer}`,
                        );
                    });
                    build.onLoad(
                        { filter: /.*/, namespace: "deno" },
                        async (args) => {
                            const module = modules.get(args.path);
                            if (!module?.local) {
                                throw new Error(
                                    `Missing cached source for ${args.path}`,
                                );
                            }
                            let contents = await Deno.readTextFile(
                                module.local,
                            );
                            // @std/assert/equal.ts otherwise references absent WeakRef on Node 12.
                            if (
                                /^https:\/\/jsr.io\/@std\/assert\/[^/]+\/equal.ts$/
                                    .test(args.path)
                            ) {
                                contents = contents.replace(
                                    "a instanceof WeakRef",
                                    'typeof WeakRef !== "undefined" && a instanceof WeakRef',
                                );
                            }
                            const source = ts.createSourceFile(
                                args.path,
                                contents,
                                ts.ScriptTarget.Latest,
                                true,
                                ts.ScriptKind.TS,
                            );
                            const transformed = ts.transform(source, [
                                (transformation) => {
                                    const visit: ts.Visitor = (node) => {
                                        const visited = ts.visitEachChild(
                                            node,
                                            visit,
                                            transformation,
                                        );
                                        if (
                                            ts.isCallExpression(visited) &&
                                            ts.isPropertyAccessExpression(
                                                visited.expression,
                                            ) &&
                                            ts.isIdentifier(
                                                visited.expression.expression,
                                            ) &&
                                            visited.expression.expression
                                                    .text === "Object" &&
                                            visited.expression.name.text ===
                                                "hasOwn"
                                        ) {
                                            return ts.factory
                                                .createCallExpression(
                                                    ts.factory.createIdentifier(
                                                        "testHasOwn",
                                                    ),
                                                    visited.typeArguments,
                                                    visited.arguments,
                                                );
                                        }
                                        if (
                                            ts.isCallExpression(visited) &&
                                            ts.isPropertyAccessExpression(
                                                visited.expression,
                                            ) &&
                                            Object.hasOwn(
                                                portableMethods,
                                                visited.expression.name.text,
                                            )
                                        ) {
                                            return ts.factory
                                                .createCallExpression(
                                                    ts.factory.createIdentifier(
                                                        portableMethods[
                                                            visited.expression
                                                                .name.text
                                                        ],
                                                    ),
                                                    visited.typeArguments,
                                                    [
                                                        visited.expression
                                                            .expression,
                                                        ...visited.arguments,
                                                    ],
                                                );
                                        }
                                        return visited;
                                    };
                                    return (node) =>
                                        ts.visitNode(
                                            node,
                                            visit,
                                        ) as ts.SourceFile;
                                },
                            ]);
                            contents = ts.createPrinter().printFile(
                                transformed.transformed[0],
                            );
                            transformed.dispose();
                            return { contents, loader: "ts" };
                        },
                    );
                },
            }],
        });
    }
    await Deno.writeTextFile(
        resolve(destination, "manifest.json"),
        JSON.stringify(
            files.map((file) => ({
                source: relative(root, file),
                bundle: relative(resolve(root, "test"), file).replaceAll(
                    "/",
                    "_",
                ).replace(/\.ts$/, ".cjs"),
            })),
            null,
            2,
        ) + "\n",
    );
    console.log(`Built ${files.length} upstream test modules for Node 12.20+`);
} finally {
    await Deno.remove(entry);
    esbuild.stop();
}
