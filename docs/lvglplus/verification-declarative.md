# 通用声明式能力验证（2026-10-16）

环境：macOS arm64、Node 24.16、LVGL 9.5.0、项目固定的 Emscripten。原 0.2.0 验证记录保留，本文件单列新增能力，不把源码或交叉编译当作硬件验收。

| 检查 | 结果 |
| --- | --- |
| `pnpm test` | 29 项通过，无跳过；新增展开/诊断和共享运行时检查 |
| `pnpm test:c` | 3 项通过：核心、线程队列、声明式程序 |
| `pnpm build:wasm` | 标准公共 C 核心/渲染器构建成功 |
| `pnpm test:render` | 既有 vehicle 的 native/WASM/生成 C 精确像素一致，20 次热更新及真实输入回归通过 |
| `pnpm test:extensions` | 6 项 CTest 在 ASan/UBSan 配置下通过；包含图形和 25 轮 UI 创建/附着/销毁；原字体/翻译/自定义控件兼容验证通过 |
| Rider 字库/WASM | manifest 字库生成与项目运行时构建成功；没有项目 `native.sources` |
| `pnpm test:declarative` | home/radar/team/messages/pause-rate 五场景：原生解释、生成 C、WASM 的 Model/质量/对象边界/全像素一致 |
| Studio 浏览器 | 840×480 真实画布、中文/大号字库、方向键切换、Enter 打招呼、消息按钮、Esc 返回、时钟运行通过；隔离浏览器无未处理脚本异常 |
| ARM | Cortex-M4 的公共核心、LVGL、图形渲染器、生成 vehicle UI 与 BSP 示例静态库交叉编译通过；未链接/烧录具体固件 |

新增共享运行时检查包括：100ms 快照在粗/细步进时均采样 300ms；聚类具有传递性；组中心和 fitScale 数值正确；动作参数类型/guard 拒绝后不修改状态；畸形包保留旧视图；交换字段使用旧状态同时提交；暂停/倍率/重置及有界定时积压不丢事件。未提交批次和通知过程中的动作被拒绝。

Rider 自动化证据位于 `examples/rider/.lvglplus/parity`，审阅后的 home/radar/team 基线位于 `examples/rider/baselines`。重新验收：

```sh
pnpm test
pnpm test:c
pnpm build:wasm
pnpm test:render
pnpm test:extensions
node packages/cli/dist/main.js build examples/rider --wasm
pnpm test:declarative
```

只有主动审阅了预期视觉变化后，才运行 `node tests/declarative-parity.mjs --update-baselines`。缺失基线默认失败。

本轮没有修改 DBC，也未以旧 vcan 记录代表新设备通过。CI 已接入 Rider 一致性检查，但本地通过不代表远端 Linux/Windows CI 已通过。没有执行真实 MCU、车辆网络、DRM 实屏、Flash 升级或物理帧率测量。Rider 是通用能力验收工程，原 Rider Radar 的全部业务和像素复刻仍为应用迁移任务。
