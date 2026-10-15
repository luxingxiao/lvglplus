import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as monaco from "monaco-editor/esm/vs/editor/editor.api";
import "monaco-editor/esm/vs/basic-languages/xml/xml.contribution";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import {
  flatten,
  type ProjectIR,
  type ProjectManifest,
  type DataEvent,
  type Diagnostic,
} from "@lvglplus/compiler";
import { PreviewRuntime, type SignalSnapshot } from "./runtime";
import "./style.css";
(globalThis as any).MonacoEnvironment = { getWorker: () => new EditorWorker() };
type Source = {
  mode: string;
  connected: boolean;
  error: string;
  paused: boolean;
  speed: number;
  positionMs: number;
  durationMs: number;
  modelNowMs: number;
};
type Session = {
  token: string;
  ir: ProjectIR;
  manifest: ProjectManifest;
  target: string;
  files: Record<string, string>;
  source: Source;
  data: DataEvent[];
};

function XmlEditor({
  value,
  onChange,
  onSave,
}: {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    editor = useRef<monaco.editor.IStandaloneCodeEditor>(null),
    changeRef = useRef(onChange),
    saveRef = useRef(onSave);
  changeRef.current = onChange;
  saveRef.current = onSave;
  useEffect(() => {
    editor.current = monaco.editor.create(host.current!, {
      value,
      language: "xml",
      theme: "vs-dark",
      fontSize: 12,
      lineHeight: 21,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      padding: { top: 16 },
      wordWrap: "on",
      overviewRulerLanes: 0,
      renderLineHighlight: "none",
    });
    const sub = editor.current.onDidChangeModelContent(() =>
      changeRef.current(editor.current!.getValue()),
    );
    editor.current.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
      saveRef.current(),
    );
    return () => {
      sub.dispose();
      editor.current?.dispose();
    };
  }, []);
  useEffect(() => {
    if (editor.current && editor.current.getValue() !== value)
      editor.current.setValue(value);
  }, [value]);
  return <div className="xml-editor" ref={host} />;
}
function SignalRow({
  signal,
  derived,
  inject,
}: {
  signal: SignalSnapshot;
  derived: boolean;
  inject: (name: string, value: unknown) => void;
}) {
  const [text, setText] = useState(String(signal.value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current)
      setText(
        typeof signal.value === "number"
          ? String(Math.round(signal.value * 100) / 100)
          : signal.value,
      );
  }, [signal.value]);
  return (
    <div className="signal-row">
      <span className={"quality q" + signal.quality} />
      <span className="signal-name" title={signal.name}>
        {signal.name}
      </span>
      <input
        aria-label={signal.name}
        disabled={derived}
        value={text}
        onFocus={() => (focused.current = true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          focused.current = false;
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            inject(
              signal.name,
              signal.type === 3
                ? text
                : signal.type === 2
                  ? text === "true" || text === "1"
                  : Number(text),
            );
            focused.current = false;
            e.currentTarget.blur();
          }
        }}
      />
      <small>
        {derived
          ? "FX"
          : ["LIVE", "STALE", "INVALID", "OFFLINE"][signal.quality]}
      </small>
    </div>
  );
}
function App() {
  const [session, setSession] = useState<Session>(),
    [files, setFiles] = useState<Record<string, string>>({}),
    [file, setFile] = useState(""),
    [ir, setIR] = useState<ProjectIR>(),
    [target, setTarget] = useState("");
  const [source, setSource] = useState<Source>(),
    [signals, setSignals] = useState<SignalSnapshot[]>([]),
    [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [status, setStatus] = useState("Connecting to local workspace…"),
    [error, setError] = useState(""),
    [selected, setSelected] = useState(""),
    [inspector, setInspector] = useState(false),
    [bounds, setBounds] = useState<number[]>();
  const [showEditor, setShowEditor] = useState(true),
    [gatewayInterface, setGatewayInterface] = useState("vcan0");
  const canvas = useRef<HTMLCanvasElement>(null),
    runtime = useRef<PreviewRuntime | undefined>(undefined),
    token = useRef(""),
    clock = useRef(Date.now()),
    mode = useRef("simulation"),
    cache = useRef(new Map<string, DataEvent>()),
    irRef = useRef<ProjectIR | undefined>(undefined),
    savedFiles = useRef<Record<string, string>>({}),
    revision = useRef(0);
  irRef.current = ir;
  const request = async (url: string, body: unknown) => {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Lvglplus-Token": token.current,
      },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    return data;
  };
  const reloadPreview = async () => {
    const own = ++revision.current;
    const [response, assetsResponse] = await Promise.all([
      fetch("/api/package"),
      fetch("/api/assets"),
    ]);
    if (!response.ok) throw new Error("Cannot load compiled package");
    if (!assetsResponse.ok)
      throw new Error((await assetsResponse.json()).error);
    const bytes = new Uint8Array(await response.arrayBuffer()),
      assets = await assetsResponse.json();
    if (own !== revision.current || !runtime.current) return;
    runtime.current.assets(assets.assets);
    runtime.current.load(bytes);
    runtime.current.update([...cache.current.values()]);
    setStatus("Real LVGL · hot reload ready");
    setError("");
  };
  useEffect(() => {
    let alive = true,
      ws: WebSocket | undefined,
      raf = 0,
      preview: PreviewRuntime | undefined;
    let lastSnapshot = 0,
      frame: ImageData | undefined;
    (async () => {
      const response = await fetch("/api/session");
      if (!response.ok) throw new Error("Workspace is unavailable");
      const data: Session = await response.json();
      if (!alive) return;
      token.current = data.token;
      setSession(data);
      setFiles(data.files);
      savedFiles.current = data.files;
      setFile(data.manifest.ui);
      setIR(data.ir);
      setTarget(data.target);
      setSource(data.source);
      mode.current = data.source.mode;
      clock.current = data.source.modelNowMs;
      data.data.forEach((e) => cache.current.set(e.signal, e));
      ws = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/events?token=${data.token}`,
      );
      ws.onmessage = (e) => {
        try {
          const m = JSON.parse(e.data);
          if (m.type === "data") {
            m.events.forEach((event: DataEvent) =>
              cache.current.set(event.signal, event),
            );
            runtime.current?.update(m.events);
            clock.current = m.modelNowMs;
          } else if (m.type === "project") {
            if (m.files) {
              const previous = savedFiles.current;
              setFiles((current) =>
                Object.fromEntries(
                  Object.entries(m.files as Record<string, string>).map(
                    ([name, value]) => [
                      name,
                      current[name] === undefined ||
                      current[name] === previous[name] ||
                      current[name] === value
                        ? value
                        : current[name],
                    ],
                  ),
                ),
              );
              savedFiles.current = m.files;
              setFile((current) =>
                current in m.files ? current : m.manifest.ui,
              );
            }
            if (m.manifest)
              setSession((current) =>
                current ? { ...current, manifest: m.manifest } : current,
              );
            if (m.data) {
              cache.current.clear();
              m.data.forEach((event: DataEvent) =>
                cache.current.set(event.signal, event),
              );
            }
            setIR(m.ir);
            setTarget(m.target);
            setDiagnostics(m.diagnostics ?? []);
            void reloadPreview().catch((err) => setError(err.message));
          } else if (m.type === "diagnostics") {
            setDiagnostics(m.diagnostics);
            setStatus("XML has errors · keeping last valid preview");
          } else if (m.type === "source") {
            setSource(m);
            mode.current = m.mode;
            clock.current = m.modelNowMs;
          }
        } catch (err) {
          setError((err as Error).message);
        }
      };
      ws.onclose = () => {
        if (alive) {
          setStatus("Workspace disconnected");
          setError(
            "Local service disconnected. Reload after restarting lvglplus dev.",
          );
        }
      };
      preview = new PreviewRuntime();
      await preview.initialize();
      if (!alive) {
        preview.close();
        return;
      }
      runtime.current = preview;
      await reloadPreview();
      const draw = (at: number) => {
        if (!alive) return;
        try {
          const r = runtime.current,
            c = canvas.current;
          if (r && c && r.width && r.height) {
            if (c.width !== r.width || c.height !== r.height || !frame) {
              c.width = r.width;
              c.height = r.height;
              frame = new ImageData(r.width, r.height);
            }
            r.tick(mode.current === "replay" ? clock.current : Date.now());
            r.paint(c.getContext("2d")!, frame);
            if (at - lastSnapshot > 180) {
              lastSnapshot = at;
              setSignals(r.signals());
            }
          }
        } catch (err) {
          setError((err as Error).message);
        }
        raf = requestAnimationFrame(draw);
      };
      raf = requestAnimationFrame(draw);
    })().catch((err) =>
      setError(
        `${err.message}. If the runtime is missing, run pnpm build:wasm && pnpm build.`,
      ),
    );
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ws?.close();
      runtime.current = undefined;
      preview?.close();
    };
  }, []);
  useEffect(() => {
    if (!selected || !ir || !runtime.current) {
      setBounds(undefined);
      return;
    }
    const index = flatten(ir).findIndex((n) => n.id === selected);
    setBounds(runtime.current.bounds(index));
  }, [selected, ir, signals]);
  const save = async () => {
    try {
      const result = await request("/api/file", { file, content: files[file] });
      setDiagnostics(result.diagnostics);
      setStatus(
        result.valid
          ? "Saved · updating LVGL preview"
          : "Saved with errors · previous preview retained",
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const changeSource = async (
    mode: string,
    extra: Record<string, unknown> = {},
  ) => {
    try {
      await request("/api/source", {
        mode,
        interface: gatewayInterface,
        ...extra,
      });
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const inject = async (name: string, value: unknown) => {
    try {
      await request("/api/data", { signal: name, value });
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const pointer = (
    event: React.PointerEvent<HTMLCanvasElement>,
    pressed: boolean,
  ) => {
    const c = event.currentTarget,
      rect = c.getBoundingClientRect(),
      x = ((event.clientX - rect.left) * c.width) / rect.width,
      y = ((event.clientY - rect.top) * c.height) / rect.height;
    if (inspector && pressed && ir) {
      const nodes = flatten(ir);
      for (let i = nodes.length - 1; i >= 0; i--) {
        const b = runtime.current?.bounds(i);
        if (b && x >= b[0] && y >= b[1] && x < b[0] + b[2] && y < b[1] + b[3]) {
          setSelected(nodes[i].id);
          break;
        }
      }
      return;
    }
    runtime.current?.pointer(x, y, pressed);
    if (pressed) c.setPointerCapture(event.pointerId);
  };
  const updatePosition = (axis: "x" | "y", value: string) => {
    if (!session || file !== session.manifest.ui) return;
    const doc = new DOMParser().parseFromString(files[file], "application/xml");
    if (doc.querySelector("parsererror")) return;
    const node = Array.from(doc.querySelectorAll("[id]")).find(
      (n) => n.getAttribute("id") === selected,
    );
    if (!node) {
      setError(
        "This node comes from a component. Edit its component parameters in XML.",
      );
      return;
    }
    node.setAttribute(axis, value);
    setFiles({ ...files, [file]: new XMLSerializer().serializeToString(doc) });
  };
  const download = () => {
    const c = canvas.current;
    if (!c) return;
    const a = document.createElement("a");
    a.href = c.toDataURL("image/png");
    a.download = "lvglplus-preview.png";
    a.click();
  };
  const nodes = ir ? flatten(ir) : [];
  const selectedNode = nodes.find((n) => n.id === selected);
  return (
    <div className="app">
      <header>
        <div className="wordmark">
          <span className="logo">
            L<span>+</span>
          </span>
          <strong>LVGL PLUS</strong>
          <span className="studio-label">STUDIO</span>
        </div>
        <div className="project-name">
          <span className="dot" /> {ir?.name ?? "workspace"}{" "}
          <span className="branch">main / local</span>
        </div>
        <div className="header-actions">
          <span className="local-badge">LOCAL FIRST</span>
          <a
            href="https://github.com/luxingxiao/lvglplus"
            target="_blank"
            rel="noreferrer"
          >
            GitHub ↗
          </a>
        </div>
      </header>
      <div className="toolbar">
        <div className="breadcrumb">
          WORKSPACE <span>/</span> {ir?.name ?? "vehicle"} <span>/</span>{" "}
          <strong>{file}</strong>
        </div>
        <button onClick={() => setShowEditor(!showEditor)}>
          {showEditor ? "Hide XML" : "Show XML"}
        </button>
        <button onClick={() => void save()} className="primary">
          Save & preview <kbd>⌘ S</kbd>
        </button>
      </div>
      <main>
        <aside className="sidebar">
          <div className="section-label">PROJECT FILES</div>
          {Object.keys(files).map((name) => (
            <button
              key={name}
              className={"file " + (file === name ? "active" : "")}
              onClick={() => setFile(name)}
            >
              <span>〈/〉</span>
              {name}
            </button>
          ))}
          <div className="section-label tree-label">
            OBJECT TREE <small>{nodes.length}</small>
          </div>
          <div className="tree">
            {nodes.map((n) => (
              <button
                title={n.id}
                key={n.id}
                className={selected === n.id ? "selected" : ""}
                style={{
                  paddingLeft:
                    12 + Math.min(4, n.id.split(".").length - 1) * 10,
                }}
                onClick={() => setSelected(n.id)}
              >
                <span>
                  {n.kind === "text" ? "T" : n.kind === "panel" ? "▧" : "◇"}
                </span>
                {n.id}
              </button>
            ))}
          </div>
          <div className="sidebar-foot">
            XML → IR → LVGL
            <br />
            <span>Apache 2.0 · v0.1</span>
          </div>
        </aside>
        <section className="workspace">
          <div className="workspace-top">
            <div>
              <span className="section-label">LIVE DEVICE PREVIEW</span>
              <p>The same C core. From prototype to production.</p>
            </div>
            <div className="preview-tools">
              <select
                aria-label="Display target"
                value={target}
                onChange={async (e) => {
                  try {
                    await request("/api/target", { target: e.target.value });
                  } catch (err) {
                    setError((err as Error).message);
                  }
                }}
              >
                {ir?.targets.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name} · {t.width} × {t.height}
                  </option>
                ))}
              </select>
              <button
                className={inspector ? "enabled" : ""}
                onClick={() => setInspector(!inspector)}
              >
                ⊞ Inspector
              </button>
              <button onClick={download}>↓ PNG</button>
            </div>
          </div>
          <div
            className={"editing-area " + (!showEditor ? "preview-only" : "")}
          >
            {showEditor && (
              <div className="code-panel">
                <div className="panel-title">
                  <span>〈/〉 {file}</span>
                  <span>XML</span>
                </div>
                <XmlEditor
                  value={files[file] ?? ""}
                  onChange={(value) =>
                    setFiles((prev) => ({ ...prev, [file]: value }))
                  }
                  onSave={() => void save()}
                />
              </div>
            )}
            <div className="preview-panel">
              <div className="preview-label">
                <span className="dot" /> LVGL 9.5 / WEBASSEMBLY{" "}
                <span>INTERACTIVE</span>
              </div>
              <div className="device-stage">
                <div className="canvas-wrap">
                  <canvas
                    ref={canvas}
                    aria-label="Real LVGL instrument preview"
                    onPointerDown={(e) => pointer(e, true)}
                    onPointerUp={(e) => pointer(e, false)}
                    onPointerCancel={(e) => pointer(e, false)}
                    onPointerMove={(e) => {
                      if (e.buttons && !inspector) pointer(e, true);
                    }}
                  />
                  {inspector && bounds && runtime.current && (
                    <div
                      className="selection-box"
                      style={{
                        left: `${(bounds[0] / runtime.current.width) * 100}%`,
                        top: `${(bounds[1] / runtime.current.height) * 100}%`,
                        width: `${(bounds[2] / runtime.current.width) * 100}%`,
                        height: `${(bounds[3] / runtime.current.height) * 100}%`,
                      }}
                    />
                  )}
                </div>
              </div>
              <div className="preview-note">
                <span>{status}</span>
                <span>NO DEVICE REQUIRED</span>
              </div>
            </div>
          </div>
          {error && (
            <div className="error" role="alert">
              {error}
              <button onClick={() => setError("")}>×</button>
            </div>
          )}
          {!!diagnostics.length && (
            <div className="diagnostics" role="alert">
              {diagnostics.map((d, i) => (
                <div key={i}>
                  {d.file}:{d.line}:{d.column} · {d.code} · {d.message}
                </div>
              ))}
            </div>
          )}
          <section className="data-panel">
            <div className="data-header">
              <div>
                <span className="section-label">DATA WORKBENCH</span>
                <p>Switch the source. Keep the UI.</p>
              </div>
              <div className="source-buttons">
                {["simulation", "replay", "manual", "can"].map((m) => (
                  <button
                    key={m}
                    className={source?.mode === m ? "active" : ""}
                    onClick={() => void changeSource(m)}
                  >
                    {m === "can" ? "CAN / FD" : m.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            {source?.mode === "replay" && (
              <div className="replay">
                <button
                  onClick={() =>
                    void changeSource("replay", { paused: !source.paused })
                  }
                >
                  {source.paused ? "Play" : "Pause"}
                </button>
                <button
                  onClick={() => void changeSource("replay", { seekMs: 0 })}
                >
                  Reset
                </button>
                <input
                  aria-label="Replay timeline"
                  type="range"
                  min="0"
                  max={source.durationMs}
                  value={source.positionMs}
                  onChange={(e) =>
                    void changeSource("replay", {
                      seekMs: Number(e.target.value),
                    })
                  }
                />
                <select
                  aria-label="Replay speed"
                  value={source.speed}
                  onChange={(e) =>
                    void changeSource("replay", {
                      speed: Number(e.target.value),
                    })
                  }
                >
                  {[0.5, 1, 2, 4].map((s) => (
                    <option key={s} value={s}>
                      {s}×
                    </option>
                  ))}
                </select>
                <span>
                  {(source.positionMs / 1000).toFixed(1)}s /{" "}
                  {(source.durationMs / 1000).toFixed(1)}s
                </span>
              </div>
            )}
            {source?.mode === "can" && (
              <div className="replay">
                <input
                  aria-label="CAN interface"
                  value={gatewayInterface}
                  onChange={(e) => setGatewayInterface(e.target.value)}
                />
                <span>
                  {source.connected ? "Connected" : "Reconnecting"} ·{" "}
                  {source.error}
                </span>
              </div>
            )}
            <div className="signals-grid">
              {signals.map((s) => (
                <SignalRow
                  key={s.name}
                  signal={s}
                  derived={
                    !!ir?.signals.find((d) => d.name === s.name)?.derived
                  }
                  inject={(name, value) => void inject(name, value)}
                />
              ))}
            </div>
            <div className="data-hint">
              Enter to inject a value · FX values are computed by the shared C
              virtual machine · timestamps & quality are retained
            </div>
          </section>
        </section>
        {selectedNode && (
          <aside className="inspector">
            <div className="section-label">
              INSPECTOR<button onClick={() => setSelected("")}>×</button>
            </div>
            <h3>{selectedNode.id}</h3>
            <div className="kind-tag">{selectedNode.kind}</div>
            {bounds && (
              <div className="bounds-grid">
                {["X", "Y", "W", "H"].map((n, i) => (
                  <div key={n}>
                    <small>{n}</small>
                    <strong>{bounds[i]}</strong>
                  </div>
                ))}
              </div>
            )}
            <div className="section-label">PROPERTIES</div>
            {Object.entries(selectedNode.props).map(([k, v]) => (
              <div className="property" key={k}>
                <span>{k}</span>
                <code>{v}</code>
              </div>
            ))}
            {["x", "y"].map((axis) => (
              <label key={axis} className="property">
                {axis}
                <input
                  aria-label={"Edit " + axis}
                  type="number"
                  defaultValue={selectedNode.props[axis] ?? 0}
                  key={selected + axis}
                  onChange={(e) =>
                    updatePosition(axis as "x" | "y", e.target.value)
                  }
                />
              </label>
            ))}
            <div className="section-label">BINDINGS</div>
            {selectedNode.bindings.map((b) => (
              <div className="binding" key={b.property}>
                <strong>{b.property}</strong>
                <span>← {ir?.signals[b.signal].name}</span>
                <small>{b.twoWay ? "TWO-WAY" : "ONE-WAY"}</small>
              </div>
            ))}
            <p className="inspector-note">
              Property changes update XML. Save to rebuild the LVGL view while
              retaining model state.
            </p>
          </aside>
        )}
      </main>
      <footer>
        <span className="dot" />{" "}
        {diagnostics.length
          ? `${diagnostics.length} diagnostics`
          : "Schema valid"}
        <span>LVGL PLUS · INDEPENDENT OPEN SOURCE UI TOOLCHAIN</span>
        <span>
          {source?.mode ?? "simulation"} /{" "}
          {source?.connected ? "connected" : "offline"}
        </span>
      </footer>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
