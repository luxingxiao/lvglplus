# 首版验证记录

验证日期：2026-10-15。此记录针对本仓库的 0.1.0 首版实现，不代表 P3–P5 已完成。

## 已执行的检查

| 检查 | 本次结果与证据 |
| --- | --- |
| TypeScript / Studio 构建 | Node 24、pnpm 11.7，编译器、CLI、React/Vite/Monaco 完整构建通过 |
| 工具链测试 | XML 诊断、循环/类型拒绝、确定性生成、回放、本地服务安全边界、错误保存保留有效预览、生成目录保护、工程初始化通过 |
| C99 核心 | macOS arm64，AddressSanitizer / UndefinedBehaviorSanitizer，模型、VM、字符串、质量、命令、适配器生命周期、队列与 CAN 测试通过 |
| 跨线程采集 | 两个生产线程、4,000 个事件；接受、消费与通知数量一致，溢出显式计数 |
| 渲染一致性 | 同一工程与固定输入，原生包解释、WASM 包解释、静态生成 C 的 framebuffer 精确一致；模型与布局断言通过 |
| 交互与热更新 | 真实 LVGL 输入验证页面导航、命令、slider / switch 双向绑定；20 次重载与坏包保留通过 |
| 视觉基线 | parked / overspeed 两场景，普通与生成 C runner 均通过；基线缺失或不一致会失败 |
| DBC | cantools 生成 C 的大小端、负数、缩放、枚举、复用与 64 字节 FD 数据夹具通过；重复生成一致 |
| SocketCAN | Linux 容器内实际 vcan0，Classic、FD、负温度、错误长度输入通过；记录于本地 `build/linux-integration.log` |
| 设备显示生命周期 | 已初始化 LVGL display 的挂载、卸载及原 screen 恢复通过 ASan 检查 |
| ARM | Cortex-M4 / arm-none-eabi-gcc 静态 C 核心交叉编译通过；未执行 MCU 真机测试 |

最新 macOS 核心、渲染和工具链检查包含最终适配器/事件修复。Linux vcan 检查在这些收尾修改前通过；最后一次容器重建被 Docker Desktop 配置中的失效 HTTP 代理 `127.0.0.1:1087` 阻断，因此不能把此前 Linux 结果当作最终提交在 Linux 的全量复验。仓库提供 Linux CI 和 `pnpm test:linux` 以重复检查，不修改用户的 Docker 代理或默认 context。

## 重复执行

```sh
pnpm test
pnpm test:c
pnpm build:wasm
pnpm build
pnpm test:render
pnpm test:dbc
node packages/cli/dist/main.js test examples/vehicle --json
node packages/cli/dist/main.js test examples/vehicle --generated --json
cmake -S . -B build/arm -DCMAKE_TOOLCHAIN_FILE=cmake/arm-none-eabi.cmake -DLVP_WITH_LVGL=OFF -DBUILD_TESTING=OFF
cmake --build build/arm
pnpm benchmark
pnpm test:linux
```

Linux 容器测试需要可用的 Docker、软件包下载网络和 `NET_ADMIN`，使用有界项目挂载与独立输出目录。也可直接在 Linux 按 CI 执行 gateway / vcan 测试。视觉基线只能通过显式 `--update-baselines` 更新并人工审阅。

## 兼容矩阵

| 环境 | 当前证据 | 未验证部分 |
| --- | --- | --- |
| macOS arm64 | 工具链、真实 LVGL 原生/WASM、Studio 浏览器与核心内存检查 | 正式桌面安装包、实体设备 |
| Linux arm64 容器 | LVGL / C 编译、核心测试及内核 vcan Classic/FD | 最终收尾修改的全量复验、真实 CAN 收发器、DRM 显示 |
| Linux x64 | 配置 CI | 本机未执行远程 CI，需以 GitHub Actions 实际结果为准 |
| Windows | 配置工具链与核心 CI | 本机未运行，不能标记为已验收 |
| Cortex-M4 | 可移植 C 核心交叉编译 | BSP、显示/触摸、RTOS、性能和真实板卡 |

## 性能与发行边界

[benchmark.json](benchmark.json) 保存实测环境和数据：固定 800×480、18 个信号、36 个节点，Node 托管 WASM；包含初始化、编译与渲染、刷新延迟及预留线性内存。软件渲染循环不包含浏览器 Canvas 上传、物理屏幕刷新或设备 GPU，不能换算成产品帧率；尚未完成 CPU/峰值 RSS/实体设备冷启动的完整基准。

`pnpm release:pack` 生成本地 npm 归档，包含编译器、CLI、预构建 Studio/WASM、C SDK、固定 LVGL 源码与许可证。没有发布到 npm registry。核心能力使用独立规范，Pro 工程互操作、完整视觉设计器、动画/多语言工作流与正式 MCU 支持不在本次已验收范围内。
