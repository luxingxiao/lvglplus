// SPDX-License-Identifier: Apache-2.0
import { spawnSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(fileURLToPath(new URL("..", import.meta.url))),
  out = path.join(root, "build/linux");
await mkdir(out, { recursive: true });
function run(args) {
  const result = spawnSync(
    process.env.LVP_DOCKER_BIN ?? "docker",
    [
      ...(process.env.LVP_DOCKER_HOST
        ? ["--host", process.env.LVP_DOCKER_HOST]
        : []),
      ...args,
    ],
    { cwd: root, stdio: "inherit" },
  );
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(["build", "-f", "tests/Dockerfile", "-t", "lvglplus-test:0.1", "."]);
run([
  "run",
  "--rm",
  "--cap-add=NET_ADMIN",
  "--mount",
  `type=bind,source=${root},target=/src,readonly`,
  "--mount",
  `type=bind,source=${out},target=/out`,
  "lvglplus-test:0.1",
  "bash",
  "-lc",
  "export PATH=/opt/lvglplus/venv/bin:$PATH; " +
    "python scripts/dbc_codegen.py examples/vehicle/vehicle.dbc examples/vehicle/sources.json /out/dbc && " +
    "cmake -S /src -B /out/native -DLVP_LVGL_DIR=/src/.deps/lvgl -DLVP_DBC_DIR=/out/dbc -DLVP_SANITIZE=ON -DBUILD_TESTING=ON -DCMAKE_BUILD_TYPE=Debug && " +
    "cmake --build /out/native -j 8 && ctest --test-dir /out/native --output-on-failure && " +
    "ip link add dev vcan0 type vcan && ip link set vcan0 up && python tests/test_socketcan.py /out/native/lvp_can_gateway && " +
    "python tests/test_dbc.py && " +
    "/out/native/lvp_runner --package /src/examples/vehicle/.lvglplus/generated/ui.lvp --updates /src/examples/vehicle/.lvglplus/results/updates.tsv --at 100 --out /out/vehicle.ppm > /out/model.tsv && " +
    "python -c \"from pathlib import Path; assert Path('/out/vehicle.ppm').read_bytes() == Path('/src/examples/vehicle/.lvglplus/results/frame.ppm').read_bytes(); print('Linux/macOS framebuffer exact match')\"",
]);
