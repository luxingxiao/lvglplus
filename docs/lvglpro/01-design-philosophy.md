# 01 · 设计理念与产品定位

## 1. 从图形库到 UI 工程体系

LVGL Open 提供 C API、对象树、控件、布局、样式、渲染和输入等基础能力。LVGL Pro 主要解决围绕这些能力的生产问题：重复编写屏幕代码、设计交接偏差、编译烧录反馈慢、组件难复用、回归依赖人工，以及不同分辨率产品的工程分叉。

因此，Pro 的重点是让 UI 具备可描述、可复用、可预览、可验证、可交付的生命周期，而非用新渲染引擎替代 LVGL。生产代码仍落在 LVGL C API 上；预览也采用 LVGL 渲染。

来源：[编辑器概览](https://lvgl.io/docs/pro/editor/overview)、[C 集成](https://lvgl.io/docs/pro/integration/using-exported-c-code)。

## 2. 文本优先，视觉编辑围绕共同源文件展开

UI 工程以可读 XML 保存。它比专有二进制工程更方便搜索、版本管理、代码审查、批量修改和自动化生成。XML 属性尽量对应 LVGL 术语，例如 `width`、`flex_flow`、`style_bg_color`，降低已有 LVGL 开发者的转换成本。

Code/XML 模式与 Design 模式编辑同一套文件。前者构建底层组件与接口，后者通过拖放及属性面板组装屏幕。这一设计允许不同角色在同一工程中协作，而不是维护互相脱节的“设计源”和“开发源”。

**工程含义（分析）**：文本格式改善了 diff 和 merge 的条件，但不自动解决语义冲突。两个分支同时修改组件 API、共享资源名称或 Figma 所有权，仍需人工审查。把 XML 格式化规则和文件职责纳入团队约定才有收益。

来源：[XML 总览](https://lvgl.io/docs/pro/syntax/overview)、[编辑器概览](https://lvgl.io/docs/pro/editor/overview)。

## 3. 组件接口承担设计系统的治理职责

LVGL Pro 把“搭建 UI”的角色拆成两层：开发者通过 XML 定义可复用组件，使用 `<api>` 暴露可配置参数和 slot；使用者在 Design 模式拖入组件并配置这些公开属性。

例如，团队可以把品牌按钮的字体、圆角和状态样式固定，只暴露文案、图标与事件。这样视觉搭建并非任意改写内部对象，而是使用经过封装的组件接口。

**工程含义（分析）**：组件 API 是设计与代码的边界协议。参数过少会迫使使用者复制组件；参数过多会失去统一设计约束。稳定组件通常暴露业务相关参数，把内部布局细节留在组件内部。

来源：[组件](https://lvgl.io/docs/pro/syntax/components)、[API 与 slot](https://lvgl.io/docs/pro/syntax/api)。

## 4. 缩短反馈周期，同时保留 C 扩展能力

修改 XML 可直接触发预览，减少普通 UI 调整时的编译和烧录。需要 C 控件、事件逻辑或编译型资源变更时，则重新生成/编译预览。这里的目标是缩短最常见操作的反馈路径，并非取消编译工具链。

自定义能力分为纯 XML 组合的 Component，以及包含 C 行为、setter、内部元素和生命周期 hook 的 Widget。二者对应不同复杂度：业务外观组合优先 Component；自绘、复杂行为和精细运行时 API 使用 Widget。

来源：[控件扩展](https://lvgl.io/docs/pro/syntax/widgets)、[图片预览与重编译](https://lvgl.io/docs/pro/syntax/images)。

## 5. 逻辑与 UI 通过状态接口协作

Subject 是可观察的共享数据项，UI 声明自己绑定哪个状态，应用更新状态后触发观察者更新。温度、亮度、语言、选择项等不必全部通过保存控件指针逐个更新。

这与 MVVM 中可观察状态的思想相似，但官方机制本质是 LVGL Subject/Observer，不能据此认定它具备完整 ViewModel 框架、异步状态管理器或全自动线程调度。

来源：[数据绑定](https://lvgl.io/docs/pro/syntax/data-binding)、[LVGL Observer 源码](https://github.com/lvgl/lvgl/blob/v9.5.0/src/core/lv_observer.c)。

## 6. 用可交付输出降低工具依赖

导出后的 C 代码可以直接编译进应用，XML 不再是运行必需输入。生成文件与用户文件分离，用户可在保留的文件中实现逻辑。这给设备端提供了较清晰的退出路径。

**需要区分**：可以继续维护导出的 C，不代表可以免费重新分发 Pro 生成器或基于其 XML 规范开发外部编辑器；后者涉及独立许可。运行时 XML 更新也有另外的引擎获取边界。

来源：[生成文件规则](https://lvgl.io/docs/pro/integration/using-exported-c-code)、[XML 规范许可](https://lvgl.io/docs/pro/syntax/xml-license)。

## 7. 从单个开发者效率走向团队闭环

Figma 导入负责设计交接，Online Viewer 负责浏览器评审，CLI 负责自动化生成/验证/测试，AI 集成利用文档检索、XML 定义和截图建立反馈循环。四类工具围绕工程源文件相互衔接，而不是单独提供若干互不相干的功能。

可复用的理念是：**文本工程作为协作基础、受控组件接口作为设计边界、真实渲染作为预览基础、自动化验证作为交付门槛**。这些是本报告对官方产品机制的归纳，不是官方宣称的内部架构名称。

来源：[产品技术入口](https://lvgl.io/docs/pro)、[CLI](https://lvgl.io/docs/pro/cli)、[AI](https://lvgl.io/docs/pro/ai)。
