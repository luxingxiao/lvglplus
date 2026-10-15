# 02 · 功能特性与覆盖矩阵

> “支持”表示本次资料中有官方证据，未表示已在本机测试。版本与许可限制详见 [06](06-assessment.md)。

## 1. 四大产品工具

| 工具 | 输入与主要功能 | 输出/协作对象 | 关键限制 |
| --- | --- | --- | --- |
| Editor | XML/Design 双模式、补全、验证、预览、Inspector、资源管理、测试、动画、翻译、生成 C | XML 工程、C/H、资源及构建配置 | C 行为变化需要编译；预览配置不代表真机配置 |
| LVGL Flow for Figma | 读取设计结构、标注控件与绑定、导出 token/组件/屏幕/flow | 本地 Editor 服务写入工程 | v2.0.0+；交互语义需标注；不是任意 Figma 效果的通用编译器 |
| Online Viewer/Share | 从 GitHub 加载项目、浏览/操作和临时修改 XML | 浏览器内真实 UI 评审 | 文档说明不能编译 C，也不能保存修改回仓库 |
| CLI `lvglpro` | 无界面验证、C 生成、预览运行时编译、测试和截图 | CI 产物、错误、测试结果、PNG | 需要相应商业授权 token；不能因为 Editor 免费评估而假定 CLI 也免费 |

来源：[Editor](https://lvgl.io/docs/pro/editor/overview)、[Figma](https://lvgl.io/docs/pro/figma)、[Online](https://lvgl.io/docs/pro/online-viewer)、[CLI](https://lvgl.io/docs/pro/cli)。

## 2. Editor 具体能力

| 领域 | 已记录能力 | 工程价值/注意点 |
| --- | --- | --- |
| 开发环境 | VS Code 风格的导航、搜索、终端、调试、Git、Open VSX 扩展 | 可把 UI 与 C 逻辑开发放在同一环境；不等于所有 VS Code 扩展均兼容 |
| XML 编辑 | 属性/枚举补全、语法着色、错误检查 | API 与目标 LVGL 版本相关 |
| Design 模式 | 拖放组件、调整属性、slot 编辑、事件配置 | 以开发者公开的组件 API 限定可配置内容 |
| Inspector | 尺寸、组件名称、padding、margin、额外点击区域、位置与大小操作 | 排查视觉布局和触控区域问题 |
| 即时预览 | 使用真实 LVGL 渲染；外部 XML 修改可重新加载 | 自定义 C、编译型资源需要更新预览二进制 |
| 多语言 | XML 字符串表、预览切换、导出 LVGL 翻译数据 | 字体字形覆盖需另外保证 |
| 动画 | timeline、子 timeline、重复、延迟、反向播放 | 样式属性驱动，并非完整视频/场景编辑系统 |
| 数据绑定 | Subject 与文本、数值、flag/state、样式绑定 | 动态更新依赖 Observer；表达式自身不响应状态变化 |
| 多 target | 不同尺寸、资源、样式、视图；运行时或编译时选择 | 运行时切换通常携带全部变体资源 |
| 资源估算 | 给图片和字体分配 memory region，按容量/带宽估算 | 不是设备全系统 RAM/FPS 分析器 |
| 工程脚手架 | UI Only、VS Code、Linux、Zephyr；内置模拟器 | 板卡列表外仍需移植与配置 |

来源：[Editor](https://lvgl.io/docs/pro/editor/overview)、[Targets](https://lvgl.io/docs/pro/syntax/targets)、[Simulator](https://lvgl.io/docs/pro/integration/simulator)、[v2.0.0](https://github.com/lvgl/lvgl_pro/releases/tag/v2.0.0)。

## 3. XML 语言功能覆盖

| 类别 | 关键机制 | 详解 |
| --- | --- | --- |
| 工程 | `project.xml`、`globals.xml`、版本、主题、target、单层包含工程 | [03](03-architecture.md) |
| UI 抽象 | `<screen>`、`<component>`、`<widget>`、`<view>` | [04 §1–3](04-key-technologies.md) |
| 接口 | prop、默认值、类型、数组、枚举、param、slot、element | [04](04-key-technologies.md) |
| 布局/样式 | 对象树、Flex/Grid、共享/局部样式、part/state selector | [04](04-key-technologies.md) |
| 计算 | `#constant`、`$prop`、`{expression}` | [04](04-key-technologies.md) |
| 行为 | C 回调、导航、Subject 修改、timeline 触发 | [04](04-key-technologies.md) |
| 资源 | 图片转换、C 数组/文件、三类字体引擎、多语言 | [04](04-key-technologies.md) |
| 质量 | XML 测试动作、Subject 断言、截图基线、CLI | [04](04-key-technologies.md) |

## 4. 公开 XML 控件定义完整清单

基准目录 `lvgl_widgets_xml/v9.5.0` 中共有 **29 个 `lv_*.xml` 控件定义**，另有 `globals.xml` 保存共享元数据。以下是该目录实际覆盖范围，不应外推为 LVGL 全部扩展控件都能直接在 Pro 中使用。

| 类别（本报告归类） | 控件 |
| --- | --- |
| 对象与布局容器 | `lv_obj`、`lv_tabview` |
| 文本与输入 | `lv_label`、`lv_spangroup`、`lv_textarea`、`lv_keyboard`、`lv_spinbox` |
| 按钮与选择 | `lv_button`、`lv_imagebutton`、`lv_buttonmatrix`、`lv_checkbox`、`lv_switch`、`lv_dropdown`、`lv_roller` |
| 数值与测量 | `lv_slider`、`lv_bar`、`lv_arc`、`lv_scale`、`lv_chart`、`lv_led` |
| 图片与绘制 | `lv_image`、`lv_animimg`、`lv_gif`、`lv_canvas`、`lv_line` |
| 数据与其他 | `lv_table`、`lv_calendar`、`lv_qrcode`、`lv_spinner` |

每个定义可包含 API 属性、多参数、枚举、part 及 element 等。`lv_obj` 提供共同属性；图表 series、tabview tab 等并非普通对象属性，而通过元素接口表达。

来源：[固定提交控件定义目录](https://github.com/lvgl/lvgl_pro/tree/9380417dde7ec0a2aaae1063c95b7524342b6270/lvgl_widgets_xml/v9.5.0)、[控件 API](https://lvgl.io/docs/pro/syntax/api)。

## 5. Figma 能力小于 XML 控件全集

当前 Figma widget-support 文档明确列出可转换项：Object、Label、Button、Image、Image/Icon、Slider、Switch、Checkbox、Dropdown、Bar、QR Code、Text Area。Image 与 Image/Icon 都映射 `lv_image`。

Figma 控件选择器中灰色项属于待支持项；不应把 29 个 XML 控件定义等同于 Figma 可以完整导出的控件集合。部分 subject 文档提到 Roller 绑定，但不能据此认定当前 Figma 控件选择器已提供 Roller 的完整转换。

来源：[Figma 控件支持](https://lvgl.io/docs/pro/figma/widget-support)、[Figma Subjects](https://lvgl.io/docs/pro/figma/subjects)。

## 6. 不能当作已交付能力的事项

- XML 类型可接受值的进一步限制，例如 `color(...)`、固定字符串候选列表，语法文档标注为计划功能。
- Viewer 的 Commit/Push/Open Pull Request，在线文档仍表述为未来功能。
- 渐变在 XML 样式文档中注明预览尚不支持；不能据导出支持就认为编辑器所有效果都可预览。
- 使用当前公开 LVGL v9.5.0 仓库直接获得完整运行时 XML 引擎；当前集成文档明确说明引擎不公开。
- “一键导出即完全等同目标硬件效果和性能”；仍要验证字体、色深、驱动、渲染配置和硬件资源。

来源：[类型限制](https://lvgl.io/docs/pro/syntax/overview)、[Viewer](https://lvgl.io/docs/pro/online-viewer)、[渐变](https://lvgl.io/docs/pro/syntax/styles)、[XML 引擎](https://lvgl.io/docs/pro/integration/loading-xml-files)。
