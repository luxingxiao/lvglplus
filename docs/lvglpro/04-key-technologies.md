# 04 · 关键技术详解

> 以公开接口和机制为主。示例为本报告编写的教学片段，未执行 Pro 工具验证。涉及内部行为时明确区分官方描述与推断。

## 1. 声明式 XML 与版本化控件元数据

XML 定义描述“构建哪些对象、配置哪些属性、如何关联”，实际渲染由 LVGL 完成。每个 LVGL 版本有对应的 widget XML 目录，包含 API、类型、枚举、参数、part 和帮助文本。编辑器可据此补全与验证，自动化工具也能读取它避免生成不存在的属性。

它们是 LVGL 自己的 XML 接口元数据，不应未经验证就当作标准 XSD 或完整通用语法验证器。XML 能被标准解析器读取，只说明格式合法，不说明控件名、参数和资源引用有效。

约定包括：属性用小写和下划线；复合元素用 `-`；`$name` 引用 API 参数；`#name` 引用常量；`{...}` 表达式内用裸名称。属性支持像素、百分比、content、整数、布尔、颜色、字符串、字体/图片/Subject 等命名资源，以及数组和枚举组合类型。

例如 `lv_slider.xml` 的 `value` 包含 `value` 和 `anim` 参数，使用时写 `value="40" value-anim="true"`；模式使用 `normal/range/symmetrical` 等有明确映射的枚举。多参数属性不是任意自由键值。

来源：[语法总览](https://lvgl.io/docs/pro/syntax/overview)、[slider 定义](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/lvgl_widgets_xml/v9.5.0/lv_slider.xml)。

## 2. Screen / Component / Widget 三层抽象

| 抽象 | 定义职责 | 代码形态 | 适用场景 |
| --- | --- | --- | --- |
| Screen | 完整页面、导航、屏幕生命周期 | `screen_name_create(void)` | 首页、设置页、状态页 |
| Component | 纯 XML 组合与参数转发 | `component_create(parent, ...props)` | 卡片、品牌按钮、页面模板 |
| Widget | C 行为、复杂 API、内部元素、生命周期 | C 控件及解析桥接、set/get 等 | 自绘控件、动态列表机制、复杂图形 |

Component 可以通过 `view extends` 扩展 Widget 或其他 Component。它的 API 参数用于创建时，不会天然成为响应式属性或自动 setter。需要持续变化的值优先使用 Subject，复杂行为下沉到 Widget。

```xml
<component>
  <api>
    <prop name="caption" type="string" default="Apply"/>
  </api>
  <view extends="lv_button">
    <lv_label text="$caption" align="center"/>
  </view>
</component>
```

Screen 不支持自定义 `<api>`，预览尺寸来自工程 target。`permanent="true"` 屏幕保留对象与状态；普通屏幕通过导航创建并在离开时按对应导航机制删除。自行用 C 创建或切换屏幕时，应明确调用方的删除策略，不能假定任何对象都被自动托管。

来源：[Components](https://lvgl.io/docs/pro/syntax/components)、[Screens](https://lvgl.io/docs/pro/syntax/screens)、[Widgets](https://lvgl.io/docs/pro/syntax/widgets)。

## 3. API、slot、element 与 C 扩展

Component 的 slot 将内部对象暴露为子节点挂载点，例如标题区和内容区。实例通过 `<component_name-slot_name>` 向指定区域添加内容，并可配置其基础对象属性。这样页面模板允许扩展而不用暴露全部内部树。

Widget 的 API 更丰富：prop 映射 setter，param 表示多参数调用，enumdef 描述枚举，element 表示内部对象或非对象结构。element 的 `access` 包括：

| access | 意义 | 典型对象 |
| --- | --- | --- |
| `add` | 创建并取得新元素 | 图表 series、tab |
| `get` | 取得已存在元素 | 下拉列表、内部按钮 |
| `set` | 按索引写入 | 表格单元格 |
| `custom` | 映射自定义函数调用 | 特殊绑定/操作 |

自定义 Widget 的完整接入分为三部分：C 实现、XML API 定义、XML parser。parser 通常分 create 和 apply 回调，先创建对象，再把字符串属性转为 C 值调用 setter，并处理共同对象属性。仅写 XML API 并不能自动提供全部运行行为。

代码生成可创建构造/析构/事件 hook 和用户 setter 骨架；生成文件每次覆盖，用户文件保留。修改 C 后必须重编译预览，Viewer 无法完成这一步。

来源：[API](https://lvgl.io/docs/pro/syntax/api)、[Widget parser 与文件规则](https://lvgl.io/docs/pro/syntax/widgets)。

## 4. 布局、样式与设计 token

`view` 和子节点形成 LVGL 对象树；Flex/Grid 等布局交由 LVGL 引擎计算。响应式 UI 需要内容尺寸、百分比、grow、grid 等规则，而不是简单等比例缩放全部像素。

共享 `<styles>` 生成/对应 `lv_style_t`，便于多个对象复用。局部属性以 `style_` 前缀配置单个对象。selector 由 part 和 state 组合：共享样式可写 `selector="knob|pressed"`，局部属性可写 `style_bg_color-knob-pressed`。它映射 LVGL 样式系统，不是浏览器 CSS。

颜色、尺寸和间距可用常量作为 token，例如 `#color_primary`、`#space_md`。共享样式只初始化一次，因此不能把每个组件实例的 `$prop` 放进共享 style 初始化；实例参数应传入局部样式属性。

动态外观可用 `bind_style` 条件添加样式，或 `bind_style_prop` 将 Subject 映射到样式值。渐变语法包括线性、径向和圆锥等，但当前样式文档提示编辑器预览存在限制，必须在导出结果中核验。

来源：[View](https://lvgl.io/docs/pro/syntax/view)、[Styles](https://lvgl.io/docs/pro/syntax/styles)、[Constants](https://lvgl.io/docs/pro/syntax/constants)。

## 5. 表达式求值：创建时计算，不是数据绑定

2.0+ 支持 `{...}`，包括算术、一次比较、逻辑非、三元和字符串拼接。名称先解析 API 参数，再解析常量，其他资源名由后续处理解析。表达式也会进入导出的 C，因此每次创建组件时按当时参数求值，而非全部预计算成常量。

```xml
<lv_obj width="{columns * 80 + (columns - 1) * gap}"/>
<lv_label text="{'Channel ' . channel_id}"/>
```

边界包括：没有 `&&`/`||`；不能链式比较；不能嵌套三元；三元分支类型需兼容；字符串用 `.` 拼接；浮点行为依赖 `LV_USE_FLOAT`。XML 中 `<` 等保留字符仍应正确转义。

**最容易误用的点**：参数或 Subject 后来改变，不会让创建时表达式自动重新计算。动态更新需要 Observer 绑定或显式 C 更新。表达式错误可能使属性未设置并记录警告，不能只检查有没有显示出一个控件。

来源：[Evaluate expressions](https://lvgl.io/docs/pro/syntax/evaluate)。

## 6. Subject / Observer 数据绑定

### 6.1 状态到视图

```xml
<!-- globals.xml 内 -->
<subjects>
  <int name="subject_brightness" value="50"/>
</subjects>
```

```xml
<!-- 某个 view 内 -->
<lv_slider bind_value="subject_brightness"/>
<lv_label bind_text="subject_brightness"/>
```

应用通过 `lv_subject_set_int(&subject_brightness, value)` 更新值，绑定的观察者更新控件。支持反向写入的控件，例如 slider，可在用户操作时修改同一个 Subject，从而更新其他绑定对象。不能把“支持绑定”扩大为每个控件每个属性都具有自动双向绑定。

### 6.2 底层机制

LVGL v9.5.0 Observer 源码中，Subject 保存类型与值，并维护观察者列表；setter 完成类型检查、更新并触发通知流程。对象相关观察者有删除时取消订阅的实现。该机制属于 LVGL，而非 Pro 独占的反应式引擎。

通用 XML 文档列出 int/string/float；2.0 发布增加 pointer Subject 和图片绑定。LVGL C 层还存在 color/group 等类型。**C API 支持某类型，不等于 Pro 各 XML 上下文和 Figma 都支持相同类型集合。** Figma 的布尔通常用整数 0/1，且其当前格式说明不提供浮点格式。

### 6.3 条件绑定

`bind_flag_if_eq/gt/...` 控制 hidden、clickable 等 flag；`bind_state_if_eq/...` 控制 checked、disabled 等 state。前者用 `flag` 属性，后者用 `state`，不能混用。`bind_style`、`bind_style_prop` 负责动态样式。

典型单选组可以用一个整数 Subject，每个按钮绑定不同 `ref_value`，点击后写入对应值。状态留在 Subject，也能跨非永久屏幕重建保留。

### 6.4 应用接入边界

字符串缓冲区、pointer 指向资源和 Subject 的生命周期需要由应用明确管理；对象删除保护不代表所有外部数据都能自动释放。线程、ISR 或网络任务向 UI 更新状态时，应按目标应用的 LVGL 调度/锁约定转交 UI 上下文。本次未发现 Pro 提供自动跨线程状态投递保证。

来源：[Data Binding](https://lvgl.io/docs/pro/syntax/data-binding)、[Observer C](https://github.com/lvgl/lvgl/blob/v9.5.0/src/core/lv_observer.c)、[Observer H](https://github.com/lvgl/lvgl/blob/v9.5.0/src/core/lv_observer.h)、[Figma subjects](https://lvgl.io/docs/pro/figma/subjects)。

## 7. 事件系统与导航生命周期

事件 trigger 对应 LVGL 事件枚举，例如 `clicked` → `LV_EVENT_CLICKED`。C 回调签名为 `void callback(lv_event_t * e)`，XML 可指定 `user_data`。生成器负责注册，应用负责实现回调。

XML 内置行为包括设置 int/float/string Subject、整数步长递增/递减及边界/回卷、加载常驻屏幕、创建非永久屏幕、播放 timeline。它们覆盖常见 UI 交互，不替代完整业务流程引擎。

常驻屏幕减少重建并保存视图状态，但增加峰值 RAM；动态创建屏幕降低常驻对象数量，但要处理状态恢复、资源延迟和切换时瞬间重叠的内存。应根据页面规模作选择，而不是全局统一常驻。

来源：[Events](https://lvgl.io/docs/pro/syntax/events)、[Screens](https://lvgl.io/docs/pro/syntax/screens)。

## 8. Timeline 动画与实例化

timeline 组织多个动画，每个动画声明目标、样式属性、起止值、duration、delay、selector 和 early_apply。可以引用子组件 timeline，设置重复次数/间隔，并通过事件正向或反向播放。

官方描述的运行时过程是：注册 XML 时保存 timeline 蓝图和目标名称；创建组件/屏幕实例后创建 `lv_anim_timeline`，通过 `lv_obj_find_by_name` 等解析目标；每个实例拥有独立 timeline；触发事件时再按名称取得目标 timeline 开始播放。

这一设计支持同一组件的多实例独立播放，同时意味着名称、创建时机与生命周期都影响动画。不要把一个实例的动画引用错误用于已删除或未创建的目标。颜色动画在近期版本有相关修复记录，复杂动画应同时验证预览与导出 C。

来源：[Animations](https://lvgl.io/docs/pro/syntax/animations)、[v2.0.4 修复](https://github.com/lvgl/lvgl_pro/releases/tag/v2.0.4)。

## 9. 图片转换与部署

图片先命名注册，再由 UI 引用：`<data>` 把 PNG 转为目标颜色格式的 C 数组；`<file>` 使设备按文件路径访问图片。支持的颜色格式包含 RGB565、RGB888、ARGB8888、索引/Alpha 格式及 RGB565A8 等，具体结果要验证目标配置。

`<convert>` 可把 SVG/JPEG/PNG 缩放或转换成 PNG，在生成阶段先执行，再供 data/file 使用。单独指定宽或高保持比例，同时指定则按目标尺寸生成。源 SVG 的 `currentColor` 依赖浏览器上下文，转换前应明确颜色。

`src_path` 相对工程根目录；文件资源在设备上的路径由 `<project>_init(asset_base)` 与它拼接。C 数组资源忽略该文件基路径。文件资源需要驱动、解码器和介质支持；C 数组资源需要 Flash 与合适的访问带宽。

估算示例（理论未压缩像素数据，不包含头、对齐、缓存）：480×272 RGB565 约 255 KiB；相同尺寸 ARGB8888 约 510 KiB。若目标为 30 FPS 全屏更新，仅像素传输就约 7.47 MiB/s 或 14.94 MiB/s，尚未计入混合、总线竞争及重复读写。因此资源容量足够并不代表帧率达标。

来源：[Images](https://lvgl.io/docs/pro/syntax/images)。估算为本报告按宽×高×每像素字节×帧率计算。

## 10. 字体引擎与多语言

| 路径 | 原理与部署 | 取舍 |
| --- | --- | --- |
| `bin` | 预栅格化到固定字号；生成 `lv_font_t` C 或 `.bin` | 显示开销可预测；多字号/大字库占空间 |
| `tiny_ttf` | 从 TTF 数据或文件按需栅格化 | 适合按需中文与多字号；运行时计算和缓存需评估 |
| `freetype` | FreeType 从 TTF 文件渲染，文档面向 MPU | 功能与依赖更重；不是 MCU 一律禁用的硬性判断 |

bin 可通过 Unicode range、symbols 子集和 bpp 控制大小，fallback 串联字体。FreeType 路径文档不支持直接嵌入数据，`as_file` 视作 true。

翻译 XML 以 tag 为 key，languages 列出语言，导出为 LVGL 翻译模块所需数据并在初始化时注册。翻译字符串存在并不保证能显示：必须包含对应字形，处理文本变长、换行、基线、双向文字和语言切换。CJK 可考虑 TinyTTF，但是否优于字形子集取决于芯片、字号及字库。

来源：[Fonts](https://lvgl.io/docs/pro/syntax/fonts)、[Translations](https://lvgl.io/docs/pro/syntax/translations)。

## 11. 多 target 与资源预算

`project.xml` 可声明多个 target，每个有 display 和 memory region。`if_target` 可作用于 images/fonts/styles/consts/view 等块；多个匹配时优先首个匹配，因此默认块应置后。

导出 C 后有两种选择：运行时调用 `<project>_set_target(...)`，或编译时定义 `<PROJECT>_TARGET`。运行时选择便于同一固件覆盖不同硬件，但携带多个变体；编译时选择有利于裁剪。target 不能自动消除不兼容硬件能力，如依赖 GPU 的控件无法仅靠变换分辨率运行在低端 MCU。

memory region 的容量和带宽用于图片/字体资源占用及访问时间估算。它不是自动完成 linker script、Flash 分区与外设驱动配置的证据；这些映射需要检查生成结果并在目标构建中实现。它也不覆盖所有堆、栈、帧缓冲、动画对象或解码缓存。

来源：[Targets](https://lvgl.io/docs/pro/syntax/targets)。

## 12. 自动化测试与视觉回归

`<test>` 包含 UI 定义和 `<steps>`，支持鼠标移动、坐标点击、press/release、wait/freeze、Subject 设置/比较和 screenshot_compare。`wait` 推进正常 UI 时间，`freeze` 暂停内部时间，二者对动画截图的影响不同。

截图不存在时会创建基线，失败时保存 `_err` 图。初次跑通只代表建立了参考，不代表通过人工审定。基线应经过评审并受版本管理；CI 不应在参考图缺失时无声地把新输出当作正确结果。

坐标测试会受布局变化影响，截图受字体、色深、渲染版本和时间影响。应固定运行环境，等待稳定帧，同时用 Subject 断言检查行为。官方未在所读测试页给出像素容差算法、跨平台一致性保证或测试覆盖率指标，不应臆测其实现。

来源：[Testing](https://lvgl.io/docs/pro/syntax/testing)、[CLI](https://lvgl.io/docs/pro/cli)。

## 13. Figma 结构转换与文件所有权

LVGL Flow 将变量/样式映射为 globals token，将组件变为可复用 XML 组件，Auto Layout 映射 Flex，部分 variant 映射交互 state。控件类型和 Subject 绑定通过图层标注提供语义；普通矩形并不能可靠自动推断是按钮、滑条还是装饰。

插件标注保存在 Figma 图层的 plugin storage，随设计文件保存。本机服务写 project/globals/components/screens/images，并用 `.lvgl-flow/` 记录命名与导出状态。字体按本地 fonts → Google Fonts（可关闭）→ 可选 Inter 替代 → 缺失报告解析，不保证字体自动齐全。

重新导出不是三方 merge：`OWNED_BY=FIGMA` 文件完全再生成；改为 `OWNED_BY=USER` 后整文件跳过，后续设计变化也不再同步到该文件。这种机制解决覆盖风险，但把后续手工合并责任交给开发者，不能称为无损双向同步。

来源：[Figma 入门](https://lvgl.io/docs/pro/figma/get-started)、[标注](https://lvgl.io/docs/pro/figma/annotating)、[输出结构](https://lvgl.io/docs/pro/figma/output-structure)、[文件所有权](https://lvgl.io/docs/pro/figma/updating)。

## 14. CLI、AI 与工程反馈循环

CLI 将开发能力变成流水线接口；AI 则利用三个信息面：官方 MCP 文档问答、版本化 widget XML/示例、CLI 验证与截图。过程为查资料 → 写 XML → 验证 → 生成/编译 → 截图 → 看图修正。

官方 `https://lvgl.mcp.kapa.ai/` 服务提供只读知识问答，并非能直接操作编辑器或设备的执行代理。文件写入、CLI 执行、视觉判断由外部 AI 工具承担。闭环能降低语法和外观错误，但不能证明业务安全、触控体验或真机性能。

来源：[AI Integration](https://lvgl.io/docs/pro/ai)、[CLI](https://lvgl.io/docs/pro/cli)。

## 15. 定义顺序、作用域与预览夹具

解析依赖不是任意顺序：近期发布说明要求 fonts/images/consts 在 styles 之前，styles 在 view 之前，否则 XML 引擎可能在解析时找不到资源。静态 XML 格式正确并不能排除这类语义依赖错误。

资源可以全局或组件局部注册；运行时接口以空 scope 表示全局，或取得组件 scope 后注册局部资源。公开名称应有稳定命名规则，避免共用库和应用产生冲突。工程 `<folders>` 顺序还影响 globals 优先关系，多个项目集成必须检查最终解析的实际来源。

`<previews>` 为 Component/Widget 定义测试外观的容器，例如深色背景、居中、留白和不同尺寸。这些配置不导出到产品 C，也不作为运行时 XML 的 UI 内容加载。Screen 则使用 project target 的 display 预览。开发者不能把只存在于 preview 的 padding 或背景当作已进入实际屏幕。

来源：[v2.0.2](https://github.com/lvgl/lvgl_pro/releases/tag/v2.0.2)、[Preview](https://lvgl.io/docs/pro/syntax/preview)、[运行时 scope](https://lvgl.io/docs/pro/integration/loading-xml-files)、[工程包含](https://lvgl.io/docs/pro/syntax/project)。
