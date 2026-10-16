# LVGL Plus

[English](README.md) | **简体中文**

**面向 AI Coding 的仪表开发：同一模型，从模拟到生产。**

LVGL Plus 是 Apache 2.0 开源的仪表 UI 工具链。用独立 XML 描述界面和数据模型，在浏览器里用真实 LVGL 调试；把模拟数据替换为 CAN/DBC 或日志回放，无需改写页面；生产端编译生成的 C 数据定义与小型 C99 SDK。

它以 LVGL Pro 的产品工作流为研究参考，独立设计语言与实现，不是 Pro 工程兼容工具，不依赖 Pro 软件、授权或其 XML 引擎。

## 快速开始

需要 Node.js 24、pnpm 11.7、Python 3、CMake 3.20+、Git 和 C/C++ 编译器。构建依赖安装在项目自己的 `.deps/` 与 `.venv/`。

```sh
git clone https://github.com/luxingxiao/lvglplus.git
cd lvglplus
pnpm install
python3 scripts/bootstrap.py --wasm
pnpm build:wasm
pnpm build
pnpm dev
```

打开命令输出的 `http://127.0.0.1:5178`。Studio 提供本地 XML 编辑、真实 LVGL/WASM 预览、对象树、Inspector、目标切换、模型注入和模拟/回放数据源。`⌘/Ctrl+S` 保存并重新构建预览；语法错误保留最后有效画面。

切换 **REPLAY** 查看可暂停、倍速和定位的驾驶记录。切换 **MANUAL** 后在信号输入框按 Enter 注入值。点击设备画面中的 SETTINGS 可验证 slider/switch 的双向绑定。页面中的诊断命令在没有设备处理器时报告失败，不伪造设备成功响应。

## 无需自定义 C 控件的复杂仪表

新增通用图形、动态几何绑定、有界集合、共享数学/空间运算、原子动作、状态机、时钟、快照与声明式字体。完整语义与边界见 [声明式能力规范](docs/lvglplus/declarative.md)。

```sh
pnpm test:declarative
```

公开渲染测试使用独立编写的 `tests/fixtures/graphics` 几何夹具。应用级验证代码仅保留在本地忽略目录，不随仓库分发。生成产物使用 IR v3 / SDK ABI 2，更新后请重新构建 SDK。

## 基础能力（0.2.0）

- XML → 类型检查 → 公共 IR → WASM 预览包 / 生产 C 定义与 CMake。
- 页面、组合组件、参数、slot、共享样式、Flex、8 类基础控件、多分辨率 target。
- C99 类型化模型、派生表达式 VM、单向/双向绑定、命令状态、批量更新及生命周期清理。
- 信号时间戳、单位、有效性、超时、断线，以及带溢出统计的有界输入队列。
- 模拟、确定性回放、Linux SocketCAN/CAN FD、构建期 cantools DBC → C codec。
- 真实 LVGL 无窗口原生 runner、PNG 截图、模型断言、显式视觉基线及解释/生成 C 一致性测试。
- 无账号、无付费服务的本地 Web Studio；不执行项目提供的构建脚本。

0.2.0 增加了 Studio 拖放/缩放/重排与撤销重做、可视化绑定/事件/动画、翻译、字库、自定义 C 控件、资源管理/预算、静态 Viewer、独立 Figma 导入导出、动态 UI 包/A-B 回滚、网络/串口/MQTT/Modbus 插件、录制、MCP、迁移和桌面封装。详见 [P3–P5 使用文档](docs/lvglplus/p3-p5.md)。

源码实现与平台验收分别追踪：Linux、macOS 和 Windows 的工具链与核心 CI 已通过，Linux 的 vcan/CAN FD 软件链路及 DRM 目标编译也已通过。Electron 桌面发行、Figma 宿主、DRM 实屏、真实收发器和 MCU 实机仍需验收；交叉编译不代表板卡适配完成。见 [本轮验证记录](docs/lvglplus/verification-declarative.md) 和 [能力矩阵](docs/lvglplus/roadmap.md)。

## CLI

在源码工作区使用 `node packages/cli/dist/main.js`，分发包安装后命令名为 `lvglplus`。

```sh
node packages/cli/dist/main.js doctor --json
node packages/cli/dist/main.js init my-cluster
node packages/cli/dist/main.js validate examples/vehicle --json
node packages/cli/dist/main.js generate examples/vehicle
node packages/cli/dist/main.js build examples/vehicle
node packages/cli/dist/main.js screenshot examples/vehicle --out build/cluster.png
node packages/cli/dist/main.js test examples/vehicle --json
```

`generate` 输出专用 `.lvglplus/generated/`，每次整体替换；**用户逻辑放在该目录外**。使用 `--generated` 让 runner 链接静态生成 C，普通模式加载独立二进制 UI 包；两者共用相同渲染适配与 MVVM 核心。生产 C 路径不需要 XML/包解析器、Node.js 或浏览器。

```sh
node packages/cli/dist/main.js viewer examples/vehicle --out build/review
node packages/cli/dist/main.js budget examples/vehicle --json
node packages/cli/dist/main.js bundle examples/vehicle --out build/bundle
node packages/cli/dist/main.js mcp examples/vehicle
node packages/cli/dist/main.js build examples/custom --wasm
```

Design 模式可拖入控件、移动/缩放和配置绑定；资源面板管理 PNG。翻译和动画以 XML 为源，自定义工程示例位于 `examples/custom`。静态 Viewer 使用普通 HTTP 托管；Figma 导入入口与协议配置见 `tools/figma`、`examples/protocols`。

## 数据与嵌入式

```text
Transport → Codec → Mapping → Model → ViewModel → Binding → LVGL
                                         ↑ Commands ↓
```

Linux 真数据：先建立并配置 `can0` 或 `vcan0`，执行 `lvglplus build <project> --gateway`，再在 Studio 选择 CAN / FD。示例网关只接收数据，不发送车辆控制帧。macOS/Windows 使用模拟、回放或连接 Linux 网关的后续网络适配；不能把 SocketCAN 当作跨平台本地驱动。

设备集成从 [C SDK 与移植](docs/lvglplus/embedding.md) 开始。`lvp_ui_attach()` 将生成界面挂载到设备已经初始化的 LVGL display；调度和显示/触摸驱动由 BSP 提供。兼容记录明确区分源码可编译、模拟通过和真实设备验证。

## 验证

```sh
pnpm test                         # 编译器、回放、服务边界及保存失败行为
pnpm test:c                       # C 模型/VM/队列/命令/CAN 核心
node tests/render-parity.mjs       # 需要 LVGL 和 WASM：原生/浏览器核心/生成 C 精确对比
```

Linux 的真实 `vcan` 集成测试为 `tests/test_socketcan.py`。它与可移植 CAN 单元测试分开，不以 mock 替代内核接口验证。测试记录和限制见 [验证记录](docs/lvglplus/verification.md)。

## 文档与许可证

| 文档 | 内容 |
| --- | --- |
| [架构](docs/lvglplus/architecture.md) | 数据流、模块职责与技术决策 |
| [声明式能力](docs/lvglplus/declarative.md) | 图形、集合、动作、状态机、时钟与字体 |
| [语言与 IR](docs/lvglplus/language.md) | 项目格式、XML、字节码与二进制包 |
| [数据接入](docs/lvglplus/data.md) | 模拟、回放、DBC 与 SocketCAN |
| [嵌入式移植](docs/lvglplus/embedding.md) | C API、线程和生命周期契约 |
| [P3–P5 使用](docs/lvglplus/p3-p5.md) | 设计工具、动画、插件、包、MCP 与发行 |
| [能力与路线图](docs/lvglplus/roadmap.md) | P0–P5 的实际状态和边界 |
| [验证记录](docs/lvglplus/verification-declarative.md) | 原生、WASM、跨平台 CI 与交叉编译证据 |
| [LVGL Pro 调研](docs/lvglpro/README.md) | 前期研究资料，不是 Plus 的兼容规范 |

自有代码：[Apache License 2.0](LICENSE)。第三方依赖保持各自许可证，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。欢迎通过 [贡献指南](CONTRIBUTING.md) 提交功能、测试与设备移植。
