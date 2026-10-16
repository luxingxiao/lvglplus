# 通用声明式能力验证（2026-10-16）

以下为移除应用级示例之前的历史验收记录，不代表当前公共夹具的重新验收。应用源码和视觉基线已移出版本管理；当前公共 CI 使用独立几何夹具，运行 `pnpm test:declarative`。平滑渲染本轮证据见 [verification-rendering.md](verification-rendering.md)。

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
| 远端跨系统工具链/核心 | [CI 1fe09bf](https://github.com/luxingxiao/lvglplus/actions/runs/38845937656) 的 Ubuntu 24.04、macOS 14、Windows jobs 全部通过；不等同于三个系统的显示硬件验收 |
| Linux CI 图形/工具 | 同次 CI 的标准与 Rider native/WASM/生成 C 一致性、扩展/DBC/串口检查及 DRM 生产目标编译均通过 |
| Linux vcan / CAN FD | 同次 CI 在安装匹配的 Azure 内核额外模块后，网关构建、vcan 创建和 `test_socketcan.py` 均通过；没有跳过测试，不代表真实收发器已验证 |
| 公共 CLI | 当时的应用 CLI 双路径测试 均通过首页基线、clock 与快照序号断言 |
| ARM | Cortex-M4 的公共核心、LVGL、图形渲染器、生成 vehicle UI 与 BSP 示例静态库交叉编译通过；未链接/烧录具体固件 |

新增共享运行时检查包括：100ms 快照在粗/细步进时均采样 300ms；聚类具有传递性；组中心和 fitScale 数值正确；动作参数类型/guard 拒绝后不修改状态；畸形包保留旧视图；交换字段使用旧状态同时提交；暂停/倍率/重置及有界定时积压不丢事件。未提交批次和通知过程中的动作被拒绝。

历史应用的本地验收资料不再随仓库发布。公开验证命令为 `pnpm test`、`pnpm test:c`、`pnpm build:wasm`、`pnpm test:render`、`pnpm test:extensions` 和 `pnpm test:declarative`。

公共几何夹具采用数值像素断言和三路径精确比较，不使用已移出的应用基线。

本轮没有修改 DBC，也未以旧 vcan 记录代表新设备通过。远端图形与跨系统结果见上表；早期 CI 因 runner 缺少 `vcan` 内核模块失败；工作流增加匹配模块包安装后，上述完整 CI 全部通过。vcan 结果限软件链路，不代表真实车辆网络验收。没有执行真实 MCU、车辆网络、DRM 实屏、Flash 升级或物理帧率测量。Rider 是通用能力验收工程，原 Rider Radar 的全部业务和像素复刻仍为应用迁移任务。
