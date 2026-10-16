# 0.2.0 验证记录

日期：2026-10-15。环境：macOS arm64、Node 24、pnpm 11.7、LVGL 9.5.0、Emscripten 4.0.23。

| 检查 | 结果 |
| --- | --- |
| `pnpm test` | 26 项通过：编译器、回放、录制、服务边界、生成目录保护、翻译/动画检查、动态包/A/B、Figma 导入/API 夹具、迁移、MCP、TCP/UDP/MQTT/Modbus |
| `pnpm test:c` | C 核心与多线程队列通过 ASan/UBSan |
| `pnpm test:extensions` | 四项 CTest 通过，包含字体/控件/翻译/动画；坏包保持旧指针，附着到已有 display 的事务替换及原 screen 恢复通过；自定义工程 native/WASM 精确像素一致 |
| `pnpm test:render` | 18 信号、36 节点；原生包、WASM、生成 C 精确像素一致，20 次热更新，实际指针/双向/导航与惰性表达式通过 |
| `pnpm test:dbc` | 大小端、符号、缩放、枚举、复用、64-byte CAN FD 与确定性生成通过 |
| `pnpm test:serial` | POSIX PTY 实际 stty/open/read、分片 JSON、映射和退出通过；使用非阻塞读取避免关闭挂起 |
| Font CLI | 本机字体转换为 28px C 字库成功；测试字体不纳入项目发行 |
| ARM UI 栈 | Cortex-M4 的核心、LVGL、生成 UI、BSP 示例静态库交叉编译通过；没有链接完整固件或执行板卡 |
| 浏览器 Studio | 800×480 实际 LVGL 运行；Design 新增节点写入 XML、预览同步，Undo 恢复；浏览器没有 error/unhandled rejection |
| 浏览器 Viewer | 独立静态 HTTP 目录，320×240 自定义控件、en/de、模型输入与 PNG 导出通过；无 Node 后端 |
| 浏览器录制 | 2,995 条记录、约 1.95 MB，停止/同步成功，重读解析与相对时间戳校验通过 |

测试是本地协议对端与内核接口验证，不等同于生产 broker、Modbus PLC、USB 串口或车辆网络的验收。旧版 Linux vcan 通过记录见 [0.1 记录](verification-0.1.md)。本轮 Linux 模板、SocketCAN SDK 适配器及最后修改尚未在本机 Linux 环境重新全量验证；Docker 的失效代理阻止了依赖下载。CI 已添加 Linux DRM 编译和串口/扩展测试，必须以实际运行结果为准。

## 复现

```sh
pnpm install --frozen-lockfile
python3 scripts/bootstrap.py --wasm
pnpm build:wasm
pnpm test
pnpm test:c
pnpm test:render
pnpm test:extensions
pnpm test:dbc
pnpm test:serial
node packages/cli/dist/main.js test examples/vehicle --json
node packages/cli/dist/main.js test examples/vehicle --generated --json
cmake -S . -B build/arm-ui -DCMAKE_TOOLCHAIN_FILE=cmake/arm-none-eabi.cmake -DLVP_WITH_LVGL=ON -DLVP_MCU_SAMPLE=ON -DLVP_UI_DIR="$PWD/examples/vehicle/.lvglplus/generated" -DBUILD_TESTING=OFF
cmake --build build/arm-ui --target lvp_mcu_app -j 8
pnpm release:pack
```

纯工具链测试在没有 WASM 产物时显式跳过 Viewer 构建检查；渲染 CI 会先构建 WASM 再运行完整测试。视觉基线缺失仍然失败，不能通过静默跳过代替基线验收。

## 未完成的宿主与平台验收

- Electron 44.7.2 及封装依赖已固定，但二进制下载因网络超时失败，未执行桌面启动、签名或安装包验收。没有发布 npm 或桌面应用。
- Figma exporter 使用官方 API 的本地夹具验证，未在真实 Figma 宿主加载/导出；插件 ID 需遵守 Figma 开发者注册要求。
- Linux DRM/evdev、实体 CAN 收发器和真实显示器未测。Windows CI 配置不代表 Windows 已验收。
- MCU 仅交叉编译；BSP、Flash A/B 的掉电/擦写、显示/触摸/RTOS/内存与性能须针对选定设备补验。
- [性能文件](benchmark.json) 是 Node 托管 WASM 的软件渲染实测，不包含 Canvas 上传、物理屏刷新、GPU 或完整 CPU/峰值 RSS；不能当作设备帧率。

实现范围见 [P3–P5 使用文档](p3-p5.md) 和 [能力矩阵](roadmap.md)。


2026-10-16 通用声明式扩展的独立结果见 [新增验证记录](verification-declarative.md)，不与上述 0.2.0 历史结果混算。
