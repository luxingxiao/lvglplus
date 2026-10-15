# 05 · 工程集成与实施方法

## 1. 推荐目录与职责

下面是应用项目建议，`app/` 与 `bsp/` 为本报告的组织方式，`ui/` 内结构来自官方约定。

```text
product/
├── app/                    # 业务逻辑、UI 状态适配、事件实现
├── bsp/                    # 显示、输入、时钟、存储等平台适配
├── CMakeLists.txt
└── ui/
    ├── project.xml
    ├── globals.xml
    ├── translations.xml
    ├── components/
    ├── screens/
    ├── widgets/
    ├── images/
    ├── fonts/
    ├── custom_data/         # 可选，复制到预览的数据
    ├── user_config.cmake    # 用户维护的额外源码配置
    └── sim/                # 本地 C 模拟器（按项目模板提供）
```

来源：[项目约定](https://lvgl.io/docs/pro/syntax/project)、[Simulator](https://lvgl.io/docs/pro/integration/simulator)。

## 2. 最小示意工程

以下三个片段说明项目与 UI 的连接关系，可以分别保存为所示文件。它们只用于说明，未经过商业 CLI 验证；完整可运行参考优先使用官方 `templates/empty` 和 `tutorials`。

`project.xml`：

```xml
<project name="device_ui" lvgl_version="9.5.0" theme="default">
  <targets>
    <target name="panel">
      <display width="480" height="272"/>
    </target>
  </targets>
</project>
```

`globals.xml`：

```xml
<globals>
  <subjects>
    <int name="subject_brightness" value="50"/>
  </subjects>
</globals>
```

`screens/home.xml`：

```xml
<screen>
  <view flex_flow="column" style_pad_all="16" style_pad_row="12">
    <lv_label text="Brightness"/>
    <lv_slider width="90%" min_value="0" max_value="100"
               bind_value="subject_brightness"/>
    <lv_label bind_text="subject_brightness"/>
  </view>
</screen>
```

语义上，slider 写入亮度 Subject，label 观察它；应用也可更新同一 Subject。首次落地应先用 ASCII 文本验证链路，再加入中文字体与翻译，避免把字体缺失误判为绑定或渲染失败。

来源：[Data Binding](https://lvgl.io/docs/pro/syntax/data-binding)、[固定提交模板](https://github.com/lvgl/lvgl_pro/tree/9380417dde7ec0a2aaae1063c95b7524342b6270/templates)。

## 3. C 固件初始化链路

```c
/* 教学示意：board_* 为应用自行实现的适配函数。 */
#include "lvgl.h"
#include "device_ui.h"

void ui_start(void)
{
    lv_init();
    board_display_init();  /* 创建 lv_display，配置缓冲及 flush */
    board_input_init();    /* 如触摸/编码器 */
    board_tick_init();     /* 依平台提供 LVGL 时间源 */

    device_ui_init("A:ui");
    lv_screen_load(home_create());
}

/* 在满足 LVGL 调度/同步约束的 UI 上下文中执行。 */
void ui_set_brightness(int32_t value)
{
    lv_subject_set_int(&subject_brightness, value);
}
```

应用还要周期性调用 `lv_timer_handler()`，或接入所用 OS 的 LVGL 调度机制。`A:ui` 是 LVGL 文件系统路径约定，需对应已注册的文件系统驱动；它不是设备上天然存在的盘符。若 UI 全部资源编译为数据，可按实际生成代码传空基路径。

常驻屏幕会在 UI 初始化时创建，之后应加载已有指针，避免又调用 create 造成第二份。普通 `home_create()` 示例按非 permanent 屏幕解释。

来源：[导出 C 的初始化规则](https://lvgl.io/docs/pro/integration/using-exported-c-code)。

## 4. CMake 集成与版本固定

生成工程以 `lib-ui` 为库目标。应先提供 `lvgl` 目标，再添加 UI，并将 UI 链入应用：

```cmake
# lvgl 目标由主工程提供，并固定与 XML/生成器兼容的版本。
add_subdirectory(ui)
target_compile_definitions(lib-ui PUBLIC LV_LVGL_H_INCLUDE_SIMPLE)
target_link_libraries(product_app PRIVATE lib-ui lvgl)
```

额外源码放在 `ui/user_config.cmake`，使用实际工具版本要求的变量：

```cmake
list(APPEND LV_EDITOR_PROJECT_SOURCES
    ${CMAKE_CURRENT_LIST_DIR}/widgets/custom_meter.c
)
```

`*_gen.c/h`、生成的 CMakeLists 和清单不可手改；用户 `.c/.h` 与 `user_config.cmake` 是扩展点。2.0.2 发布记录已将旧 `component_lib_list_gen.cmake` 替换为 `included_projects_gen.cmake`，部分 CMake 文档仍保留旧名称，必须检查实际输出。

版本固定至少包含 Editor/CLI、LVGL、widget XML 元数据、Emscripten、字体源文件/转换配置与截图基线。CLI npm 版本与 Editor release tag 是否一一对应，本次未验证，不能直接把 Editor tag 拼成 npm 版本号。

来源：[CMake](https://lvgl.io/docs/pro/integration/cmake)、[v2.0.2](https://github.com/lvgl/lvgl_pro/releases/tag/v2.0.2)。

## 5. CLI 命令与 CI 阶段

官方 npm 包为 `@lvgl/lvglpro`，Node.js 最低 18，文档 CI 使用 Node 22。CLI 需要授权 token，推荐从秘密环境变量 `LVGLPRO_CLI_TOKEN` 注入，不把 token 写入源文件或命令参数日志。

| 命令 | 用途 | 不能混淆的边界 |
| --- | --- | --- |
| `validate` | XML/工程语义检查；失败非零退出 | 不等于 C 编译通过 |
| `generate` | 生成 C/H、转换资源 | 不等于目标平台链接通过 |
| `compile --target cli` | 编译 CLI 测试 runtime | 不等于 MCU 固件编译 |
| `compile --target editor` | 编译 Editor 预览 runtime | 不等于在线 Viewer 可重新编译 |
| `run-test` / `run-all-tests` | 执行一个/全部 XML UI 测试 | 不覆盖真实输入外设及物理显示链路 |
| `screenshot` | 渲染指定 screen 到 PNG，支持延迟 | 动画或异步状态需先稳定 |
| `compare` | 对比生成项目文件存在性与规范化内容 | 不是截图像素比较命令 |

在已安装并固定 CLI、配置好授权和编译依赖的 CI 中，可按下列顺序执行：

```sh
lvglpro validate ui --errorlimit 25
lvglpro generate ui
lvglpro compile ui --target cli
lvglpro run-all-tests ui
lvglpro screenshot ui screens/home.xml --out home.png --delay 200
# 随后使用产品自己的交叉工具链编译/链接固件。
```

流水线应配置任一步失败即失败，并保留诊断与截图产物。实际命令以安装版本 `--help` 为准。2.0 已移除旧 `figma-sync`、`copy-resources` 和部分 toolchain 选项，不宜复制 1.x 脚本。

官方公开 `pr-check.yml` 确实执行 generate → compile → run-all-tests，且在 token 不存在时跳过商业 CLI job。其 emsdk 配置为 4.0.6；文档示例构建 workflow 另用 4.0.23，二者用途不同，不应据后者升级 Pro 预览工具链。

来源：[CLI 文档](https://lvgl.io/docs/pro/cli)、[公开 CI](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/.github/workflows/pr-check.yml)、[文档构建 CI](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/.github/workflows/compile_docs.yml)。

## 6. 平台集成

| 场景 | 官方入口 | 应用仍需承担 |
| --- | --- | --- |
| 本地调试 | sim/、SDL 或 Win32、CMake、F5 调试 | 回调替身、数据源模拟、资源路径 |
| 嵌入式 Linux | SDL/Wayland/X11/DRM/fbdev，evdev；交叉编译 | sysroot、显示权限、输入、GPU/驱动配置 |
| Zephyr | west workspace、Kconfig、devicetree overlay、板卡模板 | SDK、HAL blob、实际板卡及面板适配 |
| Arduino IDE | 导出工程放 sketch 的 `src/` 下，配置 include 与编译选项 | 板卡资源、驱动、文件系统；重导出后的路径问题 |
| Renesas e2 Studio | 启动插件从 IDE 打开独立 Editor，读取 configuration.xml 并维护 ui/ | 插件与 Pro 版本兼容、生成代码编译与硬件配置 |
| 自有裸机/RTOS | 直接链接导出 C/H 和 LVGL | tick、timer handler、显示/输入、内存、同步、文件系统 |
| XML 动态更新 | XML 引擎、注册 API、FrogFS blob | 引擎授权、资源兼容、更新验证与回退机制 |

官方 Zephyr 文档列出 Renesas EK-RA8D1/RA6M3/RA8D2、STM32U5G9J-DK2、FRDM-MCXN947、MIMXRT1170-EVK、M5Stack Core2。该清单只表示当前模板覆盖，不表示仅支持这些芯片，也不表示所有相近板卡无须配置。

来源：[Linux](https://lvgl.io/docs/pro/integration/linux)、[Zephyr](https://lvgl.io/docs/pro/integration/zephyr)、[Simulator](https://lvgl.io/docs/pro/integration/simulator)。

Arduino 专项文档仍建议在重导出后处理嵌套头文件路径；这与通常“不手改生成文件”的规则有张力，实施时优先解决构建 include 搜索路径，或使用可重复的受控后处理，不依赖每次人工补丁。Renesas 文档包含旧插件下载及不带 asset 参数的旧初始化示例，应按当前实际生成头文件校正函数签名，不能把旧样例原样作为 2.0 接口保证。

来源：[Arduino](https://lvgl.io/docs/pro/integration/arduino-ide)、[Renesas](https://lvgl.io/docs/pro/integration/renesas)。

## 7. 实施顺序与验收门槛

1. 固定版本，先用官方简单示例贯通 XML → 预览 → C → 本地模拟器。
2. 加入一个带 API 的组件和一个 Subject，验证应用状态与用户操作双向流动。
3. 引入真实图片、中文字体和两种语言，检查资源路径与字形覆盖。
4. 集成一个代表性自定义 C Widget，确认生成/用户文件边界和预览重编译。
5. 增加第二个 target，分别检查运行时选择和编译裁剪结果。
6. 对一个业务流程建立行为断言和人工确认的截图基线，再接 CI。
7. 在最弱目标硬件上测峰值内存、切屏耗时、帧率及触控响应。
8. 如需运行时 XML 更新，再单独验证引擎版本、资源包和失败恢复，不与 C 路径验收混为一项。

以上为实施建议。公开资料调研没有完成这些验收，具体测量记录应在实施后追加到本目录。
