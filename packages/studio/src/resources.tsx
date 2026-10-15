// SPDX-License-Identifier: Apache-2.0
import React, { useEffect, useState } from "react";
export function Resources({
  request,
}: {
  request: (url: string, body: unknown) => Promise<any>;
}) {
  const [resources, setResources] = useState<{ path: string; bytes: number }[]>(
      [],
    ),
    [budget, setBudget] = useState<any>(),
    [error, setError] = useState("");
  const refresh = async () => {
    setResources(
      (await (await fetch("/api/resources")).json()).resources ?? [],
    );
    setBudget(await (await fetch("/api/budget")).json());
  };
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, []);
  return (
    <section className="design-tools">
      <h3>RESOURCES & BUDGET</h3>
      <input
        aria-label="Upload PNG resource"
        type="file"
        accept="image/png"
        onChange={async (e) => {
          try {
            const file = e.target.files?.[0];
            if (!file) return;
            const bytes = new Uint8Array(await file.arrayBuffer());
            let raw = "";
            for (const b of bytes) raw += String.fromCharCode(b);
            await request("/api/resource", {
              path: "assets/" + file.name,
              base64: btoa(raw),
            });
            await refresh();
            setError("");
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      />
      <button onClick={() => void refresh()}>Refresh budget</button>
      {resources.map((r) => (
        <div key={r.path}>
          {r.path} · {r.bytes} bytes{" "}
          <button
            onClick={async () => {
              try {
                await request("/api/resource", {
                  path: r.path,
                  operation: "delete",
                });
                await refresh();
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Delete unreferenced
          </button>
        </div>
      ))}
      {budget && (
        <p>
          UI package {budget.packageBytes} B · PNG {budget.assetBytes} B /
          decoded {budget.decodedAssetBytes} B ·{" "}
          {budget.targets
            ?.map((t: any) => `${t.name}: framebuffer ${t.framebufferBytes} B`)
            .join(" / ")}
          <br />
          {budget.estimate}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
