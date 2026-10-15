#!/usr/bin/env node
import path from "node:path";
import { flatten } from "@lvglplus/compiler";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import {
  loadProject,
  generateProject,
  initProject,
  ProjectError,
  repositoryRoot,
  inside,
  validateValue,
} from "./project.js";
import {
  buildNative,
  buildGateway,
  render,
  doctor,
  run,
  generateDBC,
} from "./build.js";
import { serve } from "./server.js";

const args = process.argv.slice(2),
  command = args.shift() ?? "help";
const flags: Record<string, string | boolean> = {};
const positional: string[] = [];
try {
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith("--")) {
      positional.push(args[i]);
      continue;
    }
    const name = args[i].slice(2);
    if (
      ["json", "generated", "wasm", "gateway", "update-baselines"].includes(
        name,
      )
    )
      flags[name] = true;
    else if (
      ["out", "target", "port", "at", "values"].includes(name) &&
      args[i + 1] &&
      !args[i + 1].startsWith("--")
    )
      flags[name] = args[++i];
    else throw new Error(`Unknown or missing option --${name}`);
  }
  const emit = (data: unknown) =>
    console.log(
      flags.json
        ? JSON.stringify(data)
        : typeof data === "string"
          ? data
          : JSON.stringify(data, null, 2),
    );
  const folder = path.resolve(positional[0] ?? "examples/vehicle");
  if (command === "help" || command === "--help")
    emit(
      "LVGL Plus 0.1\nUsage: lvglplus <init|validate|dev|generate|build|test|screenshot|doctor> [project]\nOptions: --json --target NAME --out PATH --generated --wasm --gateway --port N --at MS --values FILE --update-baselines",
    );
  else if (command === "doctor") emit(await doctor());
  else if (command === "init") {
    if (!positional[0]) throw new Error("init requires a destination");
    await initProject(folder);
    emit({ project: folder });
  } else if (command === "dev") {
    const port = Number(flags.port ?? 5178);
    if (!Number.isInteger(port) || port < 0 || port > 65535)
      throw new Error("Invalid port");
    const app = await serve(folder, port);
    emit({ url: app.url, project: folder });
    for (const signal of ["SIGINT", "SIGTERM"] as const)
      process.once(signal, () => {
        void app.close().then(() => process.exit(0));
      });
  } else {
    const project = await loadProject(folder),
      target = typeof flags.target === "string" ? flags.target : undefined;
    if (command === "validate")
      emit({
        valid: true,
        diagnostics: project.diagnostics,
        nodes: flatten(project.ir).length,
        signals: project.ir.signals.length,
      });
    else if (command === "generate") {
      if (project.sources.dbc)
        await generateDBC(project, path.join(project.root, ".lvglplus/dbc"));
      const output = await generateProject(
        project,
        typeof flags.out === "string" ? path.resolve(flags.out) : undefined,
        target,
      );
      emit({ output, formatVersion: project.ir.formatVersion });
    } else if (command === "build") {
      if (flags.wasm) {
        await run("python3", [
          path.join(repositoryRoot, "scripts/build_preview.py"),
        ]);
        emit({
          runtime: path.join(repositoryRoot, "packages/studio/public/runtime"),
        });
      } else
        emit({
          binary: flags.gateway
            ? await buildGateway(project)
            : await buildNative(project, !!flags.generated, target),
        });
    } else if (command === "screenshot") {
      const atMs = Number(flags.at ?? 0);
      if (!Number.isFinite(atMs) || atMs < 0) throw new Error("Invalid --at");
      const result = await render(project, {
        output: String(flags.out ?? "screenshot.png"),
        target,
        generated: !!flags.generated,
        atMs,
        values:
          typeof flags.values === "string"
            ? JSON.parse(await readFile(flags.values, "utf8"))
            : undefined,
      });
      emit({ output: result.output, values: result.values });
    } else if (command === "test") {
      const suite = JSON.parse(
        await readFile(await inside(project.root, "tests.json"), "utf8"),
      ) as {
        cases: {
          name: string;
          atMs?: number;
          values?: Record<string, unknown>;
          expect?: Record<string, unknown>;
          reference?: string;
        }[];
      };
      const binary = await buildNative(project, !!flags.generated, target);
      const results = [];
      for (const test of suite.cases) {
        if (!/^[A-Za-z_][\w-]*$/.test(test.name))
          throw new Error("Invalid test name");
        const result = await render(project, {
          binary,
          generated: !!flags.generated,
          target,
          output: path.join(
            project.root,
            ".lvglplus/results",
            test.name + ".png",
          ),
          atMs: test.atMs,
          values: test.values,
        });
        for (const [name, expected] of Object.entries(test.expect ?? {})) {
          const definition = project.ir.signals.find(
            (signal) => signal.name === name,
          );
          if (
            !definition ||
            !validateValue(definition.type, expected, definition.choices)
          )
            throw new Error(`Invalid expectation for ${name}`);
          const actual = result.values[name];
          if (!actual || actual.quality !== "valid")
            throw new Error(`${test.name}: ${name} missing or invalid`);
          if (
            typeof expected === "string"
              ? actual.value !== expected
              : Math.abs(Number(actual.value) - Number(expected)) > 1e-6
          )
            throw new Error(
              `${test.name}: ${name} expected ${expected}, got ${actual.value}`,
            );
        }
        if (test.reference) {
          if (flags["update-baselines"]) {
            const file = await inside(project.root, test.reference, false);
            await writeFile(file, result.png);
          } else {
            const expected = await readFile(
              await inside(project.root, test.reference),
            );
            if (!result.png.equals(expected))
              throw new Error(
                `${test.name}: screenshot mismatch. Actual: ${result.output}`,
              );
          }
        }
        results.push({
          name: test.name,
          passed: true,
          screenshot: result.output,
        });
      }
      emit({ passed: results.length, results });
    } else throw new Error(`Unknown command ${command}`);
  }
} catch (error) {
  if (flags.json)
    console.log(
      JSON.stringify({
        error: (error as Error).message,
        diagnostics: error instanceof ProjectError ? error.diagnostics : [],
      }),
    );
  else console.error((error as Error).message);
  process.exitCode = error instanceof ProjectError ? 2 : 1;
}
