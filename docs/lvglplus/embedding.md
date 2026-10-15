# C SDK 与嵌入式移植

## 生产构建

先运行 `lvglplus generate`，再将生成的 `ui_gen.c/h` 与 `sdk/src/model.c`、`vm.c`、`ui.c` 链接到应用和 LVGL。纯生成 C 路径不需要 `package.c`。若不需要图形，也可单独使用 Model/VM/CAN 核心。

```c
#include "lvgl.h"
#include "lvglplus.h"
#include "lvglplus_ui.h"
#include "ui_gen.h"

/* 设备 BSP 已初始化 LVGL、tick、显示和输入。 */
lvp_context *model = lvp_create(&vehicle_schema, NULL);
lvp_ui *view = lvp_ui_attach(model, lv_display_get_default());

/* 在 UI 线程中更新；可通过 batch 合并多个测量。 */
lvp_set_number(model, lvp_find(model, "vehicle.speed"), 42, now_ms, LVP_VALID);
lvp_tick(model, now_ms);
lv_timer_handler();
```

这是集成片段，不是可直接编译的完整 BSP。应用须检查空指针和错误码。屏幕尺寸与生成时 target 一致；应在应用的正常 LVGL 调度中运行，不要让多个线程并发调用 LVGL。

## 两种渲染宿主

- `lvp_ui_create()` 创建内存 framebuffer 和虚拟 pointer，用于 WASM/无窗口原生测试。
- `lvp_ui_attach()` 复用现有设备 display/input，避免再分配测试 framebuffer。设备管理自己的时钟和刷屏。

当前 renderer 使用内置 Montserrat 14/20/28/40/48。自定义 `lv_conf.h` 必须启用用到的字体与控件。项目测试配置启用 PNG/stdio 文件系统；真实 MCU 可以按资源路径实现自己的 LVGL FS。不是所有设备都应照搬桌面配置。

## SDK 生命周期

创建顺序：schema → Context → UI。销毁顺序反向：UI → Context → schema/package。生成 schema 是静态常量；动态包 storage 在所有引用释放后才能销毁。

Model 字符串复制到自身 256 字节缓冲；外部临时字符串不需要保持存活。Observer 由 SDK 分配，可显式解除；UI 解绑由 UI 销毁负责。Context 不得在订阅回调中销毁。

## HAL、分配与线程

HAL 可提供配对 allocate/deallocate、lock/unlock、log 和 queue_capacity。默认使用 calloc/free，适合桌面；MCU 可使用自有内存池。队列由调用者锁保护，不假定 C99 原子操作。无锁 HAL 只适用于单线程或调用方已经串行化的环境；不能从 ISR 中调用普通互斥锁版 `lvp_post`。

`lvp_set_*`、batch、订阅、命令和 UI 生命周期属于 UI 线程 API。只有 `lvp_post` 和 `lvp_stats` 在正确 HAL 保护下可跨线程。

## 数据适配器

`lvp_adapter_register/start/stop` 注册和管理非阻塞适配器；vtable 包含 start、poll、stop，最多 8 个。poll 由 UI tick 调用，后台接收线程通过 `lvp_adapter_publish` 写入有界队列。适配器显式报告 CONNECTING/CONNECTED/FAULT 状态，查询接口提供 received/dropped/errors。

适配器必须在接收线程启动前完成注册。停止适配器时先隔离其队列世代，再调用 stop；stop 必须停止并 join 后台线程。重新启动不会消费上个世代残留的测量/事件；取消的条目计入 dropped。插件负责标记自己拥有的信号离线，不应调用全局断线接口使其他源一起失效。

## 命令确认

本地命令由 SDK 设置目标信号；设备命令通过 `lvp_set_command_handler()` 交给应用，返回 PENDING/SUCCEEDED/FAILED。PENDING 后用 `lvp_command_complete(request_id, success)` 确认。最近 32 个请求记录有界保存；待确认槽位不会被覆盖，满时返回错误。应用自行实现设备超时和传输重试。

## 可选动态包

`lvp_package_load()` 使同一个 C SDK 能读取 `.lvp`，解析成功后可以创建 Context/UI。它是当前可测试的底层能力，不包含固件更新、签名验证、存储分区、升级回退或 ABI 迁移。设备使用前必须建立自己的资源/版本/生命周期策略。

## MCU 编译检查

`cmake/arm-none-eabi.cmake` 用于 Cortex-M4 的静态库交叉编译检查，可修改 CPU/FPU 选项适配具体目标。该检查证明核心可编译，不证明任何真实屏幕、CAN 控制器、RTOS 或板卡通过验收。

未指定真机板卡，因此本项目当前不发布“兼容某某 MCU 仪表”的验收声明。后续移植应提交芯片、屏幕、RTOS、工具链、RAM/Flash 和帧率实测记录。
