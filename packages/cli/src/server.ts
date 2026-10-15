import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { watch } from "node:fs";
import {
  readFile,
  writeFile,
  rename,
  realpath,
  stat,
  mkdir,
  readdir,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { WebSocketServer, WebSocket } from "ws";
import { encodePackage, flatten, type DataEvent } from "@lvglplus/compiler";
import {
  loadProject,
  inside,
  repositoryRoot,
  validateValue,
  ProjectError,
  type LoadedProject,
} from "./project.js";
import { ReplayPlayer, parseReplay, simulate } from "./data.js";
import { Recorder } from "./recording.js";
import { ProtocolAdapter } from "./protocols.js";
import { budget, runtimeDirectory } from "./artifacts.js";

const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};
const quality = new Set(["valid", "stale", "invalid", "disconnected"]);
export async function serve(folder: string, port = 5178) {
  let project = await loadProject(folder);
  let target = project.ir.targets[0].name;
  const token = randomBytes(32).toString("hex");
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: 1024 * 1024,
  });
  const send = (ws: WebSocket, value: unknown) => {
    if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 2 * 1024 * 1024)
      ws.send(JSON.stringify(value));
    else if (ws.bufferedAmount >= 2 * 1024 * 1024)
      ws.close(1013, "Preview consumer too slow");
  };
  const broadcast = (value: unknown) =>
    sockets.clients.forEach((ws) => send(ws, value));
  const cache = new Map<string, DataEvent>();
  let mode = "simulation",
    start = Date.now(),
    player: ReplayPlayer | undefined,
    can: ChildProcess | undefined;
  const recorder = new Recorder();
  let adapter: ProtocolAdapter | undefined;
  let connected = true,
    canInterface = "vcan0",
    sourceError = "",
    reconnect: NodeJS.Timeout | undefined,
    retry = 500,
    closed = false;
  const time = () =>
    mode === "replay" ? (player?.positionMs ?? 0) : Date.now();
  function sourceState() {
    return {
      mode,
      connected,
      error: sourceError,
      paused: player?.paused ?? false,
      speed: player?.speed ?? 1,
      positionMs: player?.positionMs ?? 0,
      durationMs: player?.duration ?? 0,
      modelNowMs: time(),
      adapters: (project.sources.adapters ?? []).map((c) => c.name),
      adapterStats: adapter?.stats,
      recording: recorder.active,
      recordingError: recorder.error,
    };
  }
  function data(events: DataEvent[]) {
    recorder.enqueue(events, time());
    for (const event of events) cache.set(event.signal, event);
    if (events.length) broadcast({ type: "data", events, modelNowMs: time() });
  }
  function mark(q: DataEvent["quality"]) {
    const names = new Set([
      ...Object.keys(project.sources.simulation ?? {}),
      ...Object.values(project.sources.mappings ?? {}),
      ...(project.sources.adapters ?? []).flatMap((c) =>
        Object.values(c.mappings),
      ),
    ]);
    data(
      [...names].map((signal) => ({
        signal,
        value:
          cache.get(signal)?.value ??
          project.ir.signals.find((s) => s.name === signal)!.initial,
        timestampMs: time(),
        quality: q,
      })),
    );
  }
  function stopCan() {
    if (reconnect) clearTimeout(reconnect);
    reconnect = undefined;
    const child = can;
    can = undefined;
    child?.kill("SIGTERM");
  }
  async function startCan(iface: string) {
    if (!/^[a-zA-Z0-9_.:-]{1,15}$/.test(iface))
      throw new Error("Invalid CAN interface");
    if (process.platform !== "linux")
      throw new Error(
        "SocketCAN requires Linux. Use simulation/replay on this host.",
      );
    const executable = await inside(
      project.root,
      ".lvglplus/gateway/lvp_can_gateway",
    );
    function connect() {
      if (closed || mode !== "can") return;
      const child = spawn(executable, [iface], {
        cwd: project.root,
        stdio: ["ignore", "pipe", "pipe"],
      });
      can = child;
      const lines = createInterface({ input: child.stdout! });
      lines.on("line", (line) => {
        if (line.length > 65536 || can !== child) return;
        try {
          const message = JSON.parse(line);
          if (message.type === "signal") {
            const def = project.ir.signals.find(
              (s) => s.name === message.signal,
            );
            if (
              !def ||
              def.derived ||
              !validateValue(def.type, message.value, def.choices) ||
              !Number.isFinite(message.timestampMs)
            )
              throw new Error("Invalid gateway signal");
            data([
              {
                signal: def.name,
                value: message.value,
                timestampMs: message.timestampMs,
                quality: "valid",
              },
            ]);
          } else if (message.type === "connection") {
            connected = !!message.connected;
            if (connected) {
              sourceError = "";
              retry = 500;
            }
          } else if (message.type === "decode-error") {
            sourceError = "CAN frame failed DBC validation";
            mark("invalid");
          } else if (message.type === "stats")
            broadcast({ type: "gateway-stats", ...message });
        } catch (e) {
          sourceError = (e as Error).message;
        }
      });
      child.stderr!.on("data", (chunk) => {
        sourceError = String(chunk).trim().slice(-512);
      });
      child.on("error", (error) => {
        sourceError = error.message;
      });
      child.on("exit", () => {
        lines.close();
        if (can !== child) return;
        can = undefined;
        connected = false;
        mark("disconnected");
        if (!closed && mode === "can") {
          reconnect = setTimeout(connect, retry);
          retry = Math.min(retry * 2, 5000);
        }
      });
    }
    connect();
  }
  async function changeSource(request: Record<string, unknown>) {
    const requested = String(request.mode ?? mode);
    if (
      ![
        "simulation",
        "replay",
        "manual",
        "can",
        ...(project.sources.adapters ?? []).map((c) => c.name),
      ].includes(requested)
    )
      throw new Error("Unknown source mode");
    if (
      request.speed !== undefined &&
      (!Number.isFinite(Number(request.speed)) ||
        Number(request.speed) < 0.1 ||
        Number(request.speed) > 16)
    )
      throw new Error("Replay speed must be 0.1..16");
    if (
      request.seekMs !== undefined &&
      (!Number.isFinite(Number(request.seekMs)) || Number(request.seekMs) < 0)
    )
      throw new Error("Seek must be nonnegative");
    if (request.paused !== undefined && typeof request.paused !== "boolean")
      throw new Error("paused must be boolean");
    const iface = String(request.interface ?? canInterface);
    if (requested === "can" && !/^[a-zA-Z0-9_.:-]{1,15}$/.test(iface))
      throw new Error("Invalid CAN interface");
    let nextPlayer = player;
    if (requested === "replay" && (mode !== "replay" || !player)) {
      if (!project.sources.replay) throw new Error("No replay configured");
      nextPlayer = new ReplayPlayer(
        parseReplay(
          await readFile(
            await inside(project.root, project.sources.replay),
            "utf8",
          ),
          project.ir,
        ),
        project.ir,
      );
    }
    if (requested === "can" && (mode !== "can" || iface !== canInterface)) {
      if (process.platform !== "linux")
        throw new Error("SocketCAN requires Linux");
      await inside(project.root, ".lvglplus/gateway/lvp_can_gateway");
    }
    if (requested !== mode || (requested === "can" && iface !== canInterface)) {
      if (recorder.active) await recorder.stop();
      stopCan();
      adapter?.stop();
      adapter = undefined;
      mode = requested;
      player = nextPlayer;
      start = Date.now();
      sourceError = "";
      connected = requested !== "can";
      canInterface = iface;
      retry = 500;
      mark("disconnected");
      if (requested === "can") await startCan(iface);
      const config = project.sources.adapters?.find(
        (c) => c.name === requested,
      );
      if (config) {
        adapter = new ProtocolAdapter(config, project.ir, (ok, error) => {
          connected = ok;
          sourceError = error;
          if (!ok) mark("disconnected");
          else if (error) mark("invalid");
        });
        adapter.start();
      }
    }
    if (mode === "replay" && player) {
      if (request.speed !== undefined) player.setSpeed(Number(request.speed));
      if (request.paused !== undefined) player.paused = !!request.paused;
      if (request.seekMs !== undefined)
        data(player.seek(Number(request.seekMs), Date.now()));
    }
    broadcast({ type: "source", ...sourceState() });
    return sourceState();
  }
  let reloadTimer: NodeJS.Timeout | undefined;
  async function reload() {
    try {
      const next = await loadProject(project.root);

      let nextPlayer: ReplayPlayer | undefined;
      if (mode === "replay") {
        if (!next.sources.replay) throw new Error("No replay configured");
        nextPlayer = new ReplayPlayer(
          parseReplay(
            await readFile(
              await inside(next.root, next.sources.replay),
              "utf8",
            ),
            next.ir,
          ),
          next.ir,
        );
        nextPlayer.paused = player?.paused ?? false;
        nextPlayer.setSpeed(player?.speed ?? 1);
      }
      const oldPosition = player?.positionMs ?? 0;
      project = next;
      if (adapter) {
        adapter.stop();
        adapter = undefined;
        const config = project.sources.adapters?.find((c) => c.name === mode);
        if (config) {
          adapter = new ProtocolAdapter(config, project.ir, (ok, error) => {
            connected = ok;
            sourceError = error;
            if (!ok) mark("disconnected");
            else if (error) mark("invalid");
          });
          adapter.start();
        } else {
          mode = "manual";
          connected = true;
        }
      }
      for (const [name, event] of cache) {
        const definition = project.ir.signals.find(
          (signal) => signal.name === name,
        );
        if (
          !definition ||
          definition.derived ||
          !validateValue(definition.type, event.value, definition.choices)
        )
          cache.delete(name);
      }
      files.clear();
      for (const name of [
        "plus.project.json",
        project.manifest.ui,
        project.manifest.model,
        ...(project.manifest.sources ? [project.manifest.sources] : []),
      ])
        files.add(name);
      if (!project.ir.targets.some((t) => t.name === target))
        target = project.ir.targets[0].name;
      if (nextPlayer) {
        player = nextPlayer;
        data(player.seek(oldPosition, Date.now()));
      }
      broadcast({
        type: "project",
        ir: project.ir,
        manifest: project.manifest,
        files: {
          [project.manifest.ui]: project.ui,
          [project.manifest.model]: project.model,
        },
        data: [...cache.values()],
        target,
        diagnostics: [],
        reloadedAt: Date.now(),
      });
      return { valid: true, diagnostics: [] };
    } catch (e) {
      const failure = {
        type: "diagnostics",
        diagnostics:
          e instanceof ProjectError
            ? e.diagnostics
            : [
                {
                  file: "project",
                  line: 1,
                  column: 1,
                  severity: "error",
                  code: "PROJECT",
                  message: (e as Error).message,
                },
              ],
      };
      broadcast(failure);
      return { valid: false, diagnostics: failure.diagnostics };
    }
  }
  const files = new Set([
    "plus.project.json",
    project.manifest.ui,
    project.manifest.model,
    ...(project.manifest.sources ? [project.manifest.sources] : []),
  ]);
  const watcher = watch(project.root, { recursive: true }, (_, filename) => {
    if (!filename) return;
    const changed = filename.replaceAll("\\", "/");
    if (project.manifest.native?.sources.includes(changed)) {
      broadcast({
        type: "diagnostics",
        diagnostics: [
          {
            file: changed,
            line: 1,
            column: 1,
            severity: "warning",
            code: "CUSTOM_REBUILD",
            message:
              "Custom C changed. Run lvglplus build <project> --wasm, then reload the browser.",
          },
        ],
      });
      return;
    }
    const resource = flatten(project.ir).some(
      (n) => n.props.src?.slice(2) === changed,
    );
    if (!files.has(changed) && !resource) return;
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      void reload();
    }, 150);
  });
  async function body(req: http.IncomingMessage) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) throw new Error("Request exceeds 2 MiB");
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
      string,
      unknown
    >;
  }
  function authenticated(req: http.IncomingMessage) {
    const value = req.headers["x-lvglplus-token"];
    return (
      typeof value === "string" &&
      value.length === token.length &&
      timingSafeEqual(Buffer.from(value), Buffer.from(token))
    );
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    const respond = (status: number, value: unknown) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(value));
    };
    try {
      const host = req.headers.host ?? "";
      const address = server.address();
      const actualPort =
        typeof address === "object" && address ? address.port : port;
      if (
        ![`127.0.0.1:${actualPort}`, `localhost:${actualPort}`].includes(host)
      ) {
        respond(403, { error: "Invalid local host" });
        return;
      }
      if (
        req.headers.origin &&
        ![
          `http://127.0.0.1:${actualPort}`,
          `http://localhost:${actualPort}`,
        ].includes(req.headers.origin)
      ) {
        respond(403, { error: "Cross-origin request rejected" });
        return;
      }
      const url = new URL(req.url ?? "/", `http://${host}`);
      if (req.method !== "GET" && !authenticated(req)) {
        respond(403, { error: "Missing session token" });
        return;
      }
      if (url.pathname === "/api/session" && req.method === "GET") {
        const texts = await Promise.all(
          [project.manifest.ui, project.manifest.model].map(async (file) => [
            file,
            await readFile(await inside(project.root, file), "utf8"),
          ]),
        );
        respond(200, {
          token,
          ir: project.ir,
          manifest: project.manifest,
          target,
          files: Object.fromEntries(texts),
          source: sourceState(),
          data: [...cache.values()],
        });
        return;
      }
      if (url.pathname === "/api/record" && req.method === "POST") {
        const request = await body(req);
        if (request.action === "stop") {
          respond(200, await recorder.stop());
          return;
        }
        if (mode === "replay")
          throw new Error("Switch to a live/manual source before recording");
        const name = String(request.name ?? "drive-" + Date.now());
        if (!/^[A-Za-z_][\w-]{0,63}$/.test(name))
          throw new Error("Invalid recording name");
        await mkdir(path.join(project.root, ".lvglplus"), { recursive: true });
        const storage = await inside(project.root, ".lvglplus");
        await mkdir(path.join(storage, "recordings"), { recursive: true });
        const file = await inside(
          project.root,
          ".lvglplus/recordings/" + name + ".jsonl",
          false,
        );
        await recorder.start(file, time());
        respond(200, { path: ".lvglplus/recordings/" + name + ".jsonl" });
        return;
      }
      if (url.pathname === "/api/resources" && req.method === "GET") {
        const entries = [];
        try {
          for (const name of await readdir(
            await inside(project.root, "assets"),
          )) {
            if (!/^[A-Za-z_][\w.-]*\.png$/.test(name)) continue;
            const file = await inside(project.root, "assets/" + name);
            const info = await stat(file);
            if (info.isFile())
              entries.push({ path: "assets/" + name, bytes: info.size });
          }
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
        respond(200, { resources: entries });
        return;
      }
      if (url.pathname === "/api/resource" && req.method === "POST") {
        const request = await body(req);
        const name = String(request.path);
        if (!/^assets\/[A-Za-z_][\w.-]*\.png$/.test(name))
          throw new Error("Resources must be assets/name.png");
        await mkdir(path.join(project.root, "assets"), { recursive: true });
        const file = await inside(project.root, name, false);
        if (request.operation === "delete") {
          if (flatten(project.ir).some((n) => n.props.src === "A:" + name))
            throw new Error("Resource is referenced by the active UI");
          await rm(await inside(project.root, name));
        } else {
          if (
            typeof request.base64 !== "string" ||
            !/^[A-Za-z0-9+/]*={0,2}$/.test(request.base64)
          )
            throw new Error("Invalid resource encoding");
          const bytes = Buffer.from(request.base64, "base64");
          if (
            bytes.length < 24 ||
            bytes.length > 1024 * 1024 ||
            !bytes
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
            bytes.readUInt32BE(16) < 1 ||
            bytes.readUInt32BE(20) < 1 ||
            bytes.readUInt32BE(16) > 4096 ||
            bytes.readUInt32BE(20) > 4096
          )
            throw new Error("Expected PNG <=1 MiB, dimensions <=4096");
          const temporary = file + ".lvp-" + randomBytes(8).toString("hex");
          await writeFile(temporary, bytes, { flag: "wx" });
          await rename(temporary, file);
        }
        respond(200, { ok: true, path: name });
        return;
      }
      if (url.pathname === "/api/budget" && req.method === "GET") {
        respond(200, await budget(project));
        return;
      }
      if (url.pathname === "/api/package" && req.method === "GET") {
        const selected = project.ir.targets.find((t) => t.name === target)!;
        res.writeHead(200, { "Content-Type": "application/octet-stream" });
        res.end(encodePackage(project.ir, selected));
        return;
      }
      if (url.pathname === "/api/assets" && req.method === "GET") {
        const names = [
          ...new Set(
            flatten(project.ir)
              .filter((n) => n.kind === "image" && n.props.src)
              .map((n) => n.props.src.slice(2)),
          ),
        ];
        const assets = [];
        let total = 0;
        for (const name of names) {
          const file = await inside(project.root, name);
          const info = await stat(file);
          if (
            info.size > 2 * 1024 * 1024 ||
            (total += info.size) > 8 * 1024 * 1024
          )
            throw new Error("Preview assets exceed size limit");
          assets.push({
            path: name,
            base64: (await readFile(file)).toString("base64"),
          });
        }
        respond(200, { assets });
        return;
      }
      if (url.pathname === "/api/file" && req.method === "POST") {
        const request = await body(req),
          file = String(request.file);
        if (
          ![project.manifest.ui, project.manifest.model].includes(file) ||
          typeof request.content !== "string"
        )
          throw new Error("Only UI and model XML can be saved");
        const filename = await inside(project.root, file),
          temp = filename + ".lvp-" + randomBytes(8).toString("hex");
        await writeFile(temp, request.content, { flag: "wx" });
        await rename(temp, filename);
        const result = await reload();
        respond(200, result);
        return;
      }
      if (url.pathname === "/api/target" && req.method === "POST") {
        const request = await body(req);
        if (!project.ir.targets.some((t) => t.name === request.target))
          throw new Error("Unknown target");
        target = String(request.target);
        broadcast({ type: "project", ir: project.ir, target, diagnostics: [] });
        respond(200, { target });
        return;
      }
      if (url.pathname === "/api/source" && req.method === "POST") {
        respond(200, await changeSource(await body(req)));
        return;
      }
      if (url.pathname === "/api/data" && req.method === "POST") {
        const request = await body(req),
          signal = project.ir.signals.find((s) => s.name === request.signal);
        if (
          !signal ||
          signal.derived ||
          !validateValue(signal.type, request.value, signal.choices)
        )
          throw new Error("Invalid/writable signal or value");
        const q = String(request.quality ?? "valid");
        if (!quality.has(q)) throw new Error("Invalid quality");
        const event: DataEvent = {
          signal: signal.name,
          value: request.value as DataEvent["value"],
          quality: q as DataEvent["quality"],
          timestampMs: time(),
        };
        data([event]);
        respond(200, { ok: true });
        return;
      }
      if (req.method !== "GET") {
        respond(404, { error: "Unknown endpoint" });
        return;
      }
      if (
        url.pathname === "/runtime/lvp.wasm" &&
        project.manifest.native?.sources.length
      ) {
        const name = decodeURIComponent(url.pathname.slice("/runtime/".length));
        const file = await inside(runtimeDirectory(project), name);
        res.writeHead(200, {
          "Content-Type":
            mime[path.extname(file)] ?? "application/octet-stream",
        });
        res.end(await readFile(file));
        return;
      }
      const staticRoot = path.join(repositoryRoot, "packages/studio/dist");
      const relative =
        decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
      const filename = await inside(staticRoot, relative);
      if (!(await stat(filename)).isFile()) throw new Error("Not a file");
      res.writeHead(200, {
        "Content-Type":
          mime[path.extname(filename)] ?? "application/octet-stream",
      });
      res.end(await readFile(filename));
    } catch (e) {
      respond(400, { error: (e as Error).message });
    }
  });
  server.on("upgrade", (req, socket, head) => {
    const address = server.address();
    const actualPort =
      typeof address === "object" && address ? address.port : port;
    const origin = req.headers.origin;
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${actualPort}`);
    if (
      url.pathname !== "/events" ||
      url.searchParams.get("token") !== token ||
      ![
        `http://127.0.0.1:${actualPort}`,
        `http://localhost:${actualPort}`,
      ].includes(origin ?? "")
    ) {
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(req, socket, head, (ws) => {
      send(ws, { type: "source", ...sourceState() });
      send(ws, {
        type: "data",
        events: [...cache.values()],
        modelNowMs: time(),
      });
    });
  });
  const interval = setInterval(() => {
    const now = Date.now();
    if (mode === "simulation")
      data(simulate(project.ir, project.sources, now - start, now));
    else if (mode === "replay" && player) data(player.advance(now));
    else if (adapter) data(adapter.drain());
    broadcast({ type: "source", ...sourceState() });
  }, 100);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  const actualPort =
    typeof address === "object" && address ? address.port : port;
  return {
    url: `http://127.0.0.1:${actualPort}`,
    server,
    close: async () => {
      closed = true;
      adapter?.stop();
      await recorder.stop();
      clearInterval(interval);
      if (reloadTimer) clearTimeout(reloadTimer);
      stopCan();
      watcher.close();
      for (const ws of sockets.clients) ws.terminate();
      sockets.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
