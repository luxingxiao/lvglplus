// SPDX-License-Identifier: Apache-2.0
// MCP 2025-06-18 stdio. Only JSON-RPC belongs on stdout.
import { createInterface } from "node:readline";
import path from "node:path";
import { loadProject, generateProject } from "./project.js";
import { ModelSession } from "./session.js";
import { budget } from "./artifacts.js";
const schema = (
  properties: Record<string, unknown> = {},
  required: string[] = [],
) => ({ type: "object", properties, required, additionalProperties: false });
const text = { type: "string" };
const definitions = [
  {
    name: "validate",
    description: "Validate the current project with source diagnostics.",
    inputSchema: schema(),
  },
  {
    name: "generate",
    description: "Generate C in the project-owned output directory.",
    inputSchema: schema(),
  },
  {
    name: "model_read",
    description: "Read model values evaluated by the shared C/WASM runtime.",
    inputSchema: schema(),
  },
  {
    name: "model_write",
    description:
      "Write a simulated model signal; never sends a device command.",
    inputSchema: schema(
      { signal: text, value: { type: ["number", "string", "boolean"] } },
      ["signal", "value"],
    ),
  },
  {
    name: "node_inspect",
    description: "Inspect IR nodes and real LVGL geometry.",
    inputSchema: schema({ id: text }),
  },
  {
    name: "screenshot",
    description: "Render PNG with the shared LVGL runtime.",
    inputSchema: schema(),
  },
  {
    name: "resource_budget",
    description: "Inspect resource and framebuffer budgets.",
    inputSchema: schema(),
  },
];
export async function serveMCP(folder: string) {
  let runtime: ModelSession | undefined;
  let initialized = false;
  const session = async () =>
    runtime ??
    (runtime = await new ModelSession(await loadProject(folder)).open());
  const reply = (id: unknown, result: unknown, error = false) =>
    process.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        ...(error ? { error: result } : { result }),
      }) + "\n",
    );
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      let request: any;
      try {
        if (Buffer.byteLength(line) > 2 * 1024 * 1024)
          throw Error("Request limit");
        request = JSON.parse(line);
        if (request.jsonrpc !== "2.0" || typeof request.method !== "string")
          throw Error("Invalid request");
        if (request.id === undefined) continue;
        if (request.method === "initialize") {
          if (
            !["2025-06-18", "2025-11-25", "2024-11-05"].includes(
              request.params?.protocolVersion,
            )
          ) {
            reply(
              request.id,
              { code: -32602, message: "Supported protocol: 2025-06-18" },
              true,
            );
            continue;
          }
          initialized = true;
          reply(request.id, {
            protocolVersion: "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: "lvglplus", version: "0.2.0" },
          });
        } else if (!initialized)
          reply(
            request.id,
            { code: -32002, message: "Initialize first" },
            true,
          );
        else if (request.method === "ping") reply(request.id, {});
        else if (request.method === "tools/list")
          reply(request.id, { tools: definitions });
        else if (request.method === "tools/call") {
          const name = request.params?.name,
            a = request.params?.arguments ?? {};
          let value: unknown;
          try {
            if (!definitions.some((d) => d.name === name))
              throw Error("Unknown tool");
            if (name === "validate") {
              runtime?.close();
              runtime = undefined;
              const p = await loadProject(folder);
              value = { valid: true, diagnostics: p.diagnostics };
            } else if (name === "generate")
              value = {
                output: await generateProject(await loadProject(folder)),
              };
            else if (name === "resource_budget")
              value = await budget(await loadProject(folder));
            else if (name === "model_read") value = (await session()).read();
            else if (name === "model_write")
              value = (await session()).write(a.signal, a.value);
            else if (name === "node_inspect")
              value = (await session()).inspect(a.id);
            else if (name === "screenshot") {
              const r = await session();
              reply(request.id, {
                content: [
                  {
                    type: "image",
                    data: r.png().toString("base64"),
                    mimeType: "image/png",
                  },
                ],
              });
              continue;
            }
            reply(request.id, {
              content: [{ type: "text", text: JSON.stringify(value) }],
            });
          } catch (e) {
            reply(request.id, {
              isError: true,
              content: [{ type: "text", text: (e as Error).message }],
            });
          }
        } else
          reply(
            request.id,
            { code: -32601, message: "Method not found" },
            true,
          );
      } catch (e) {
        reply(
          request?.id ?? null,
          { code: -32700, message: (e as Error).message },
          true,
        );
      }
    }
  } finally {
    runtime?.close();
    lines.close();
  }
}
