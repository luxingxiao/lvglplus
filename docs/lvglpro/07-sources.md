# 07 · 来源与证据索引

## 1. 调研记录

- 核验日期：2026-10-15，Asia/Shanghai。
- 资料均以 LVGL 官方网站、官方 GitHub 仓库和发布 API 为主要来源；未把第三方文章当作架构事实依据。
- `lvgl_pro` 本次 shallow clone 的 HEAD：`9380417dde7ec0a2aaae1063c95b7524342b6270`；commit 时间为 2026-10-09T14:04:41+02:00，commit 时间与 release 发布时间不同。
- 最新稳定 release 的 `published_at` 为 `2026-10-14T02:32:07Z`；预发布为 `v2.1.0-beta0`。
- 下列仓库源码链接固定到本次提交，避免 master 后续变动影响复核。官网文档链接用于方便阅读，可能继续更新。
- 报告内容为机制归纳与分析，未整页复制官方文档；小型代码示例标注为教学示意。

## 2. 在线产品与版本来源

| 来源 | 用途 |
| --- | --- |
| [LVGL Pro 官网](https://lvgl.io/pro) | 产品组成、下载区与旧文案交叉检查 |
| [官方文档入口](https://lvgl.io/docs/pro) | 技术导航 |
| [公开仓库](https://github.com/lvgl/lvgl_pro) | 仓库实际范围及源文件 |
| [Releases](https://github.com/lvgl/lvgl_pro/releases) | 稳定版和预发布区分 |
| [Release API](https://api.github.com/repos/lvgl/lvgl_pro/releases?per_page=5) | published_at 与 prerelease 核验 |
| [v2.0.0](https://github.com/lvgl/lvgl_pro/releases/tag/v2.0.0) | 2.0 能力、Theia 线索、删除的旧命令 |
| [v2.0.2](https://github.com/lvgl/lvgl_pro/releases/tag/v2.0.2) | XML 依赖顺序、包含工程、生成 CMake 更名、9.5 XML 模块变化 |
| [v2.0.4](https://github.com/lvgl/lvgl_pro/releases/tag/v2.0.4) | 颜色动画及常驻屏幕修复 |
| [v2.0.5](https://github.com/lvgl/lvgl_pro/releases/tag/v2.0.5) | emsdk 选择规则 |
| [当前 Pricing](https://lvgl.io/pro/pricing) | 商业套餐快照，含席位与有效期 |

## 产品工具与协作

| 固定版本源文件 | 主要主题 |
| --- | --- |
| [docs/editor/overview.mdx](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/docs/editor/overview.mdx) | overview |
| [docs/editor/license.mdx](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/docs/editor/license.mdx) | license |
| [docs/cli.mdx](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/docs/cli.mdx) | cli |
| [docs/online-viewer.mdx](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/docs/online-viewer.mdx) | online-viewer |
| [docs/ai.mdx](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/docs/ai.mdx) | ai |

## 工程与声明式语言

| 固定版本源文件 | 主要主题 |
| --- | --- |
| [docs/syntax/introduction.mdx](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/docs/syntax/introduction.mdx) | introduction |
| [docs/syntax/overview.mdx](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/docs/syntax/overview.mdx) | overview |
| [docs/syntax/project.mdx](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/docs/syntax/project.mdx) | project |
| [docs/syntax/targets.mdx](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/docs/syntax/targets.mdx) | targets |
| [docs/syntax/components.mdx](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/docs/syntax/components.mdx) | components |
| [docs/syntax/widgets.mdx](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/docs/syntax/widgets.mdx) | widgets |
| [docs/syntax/api.mdx](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/docs/syntax/api.mdx) | api |
| [docs/syntax/view.mdx](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/docs/syntax/view.mdx) | view |
| [docs/syntax/constants.mdx](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/docs/syntax/constants.mdx) | constants |
| [docs/syntax/styles.mdx](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/docs/syntax/styles.mdx) | styles |
| [docs/syntax/evaluate.mdx](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/docs/syntax/evaluate.mdx) | evaluate |
| [docs/syntax/data-binding.mdx](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/docs/syntax/data-binding.mdx) | data-binding |
| [docs/syntax/events.mdx](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/docs/syntax/events.mdx) | events |
| [docs/syntax/screens.mdx](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/docs/syntax/screens.mdx) | screens |
| [docs/syntax/animations.mdx](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/docs/syntax/animations.mdx) | animations |
| [docs/syntax/preview.mdx](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/docs/syntax/preview.mdx) | preview |
| [docs/syntax/fonts.mdx](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/docs/syntax/fonts.mdx) | fonts |
| [docs/syntax/images.mdx](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/docs/syntax/images.mdx) | images |
| [docs/syntax/translations.mdx](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/docs/syntax/translations.mdx) | translations |
| [docs/syntax/testing.mdx](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/docs/syntax/testing.mdx) | testing |
| [docs/syntax/xml-license.mdx](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/docs/syntax/xml-license.mdx) | xml-license |

## 生成、运行与平台

| 固定版本源文件 | 主要主题 |
| --- | --- |
| [docs/integration/using-exported-c-code.mdx](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/docs/integration/using-exported-c-code.mdx) | using-exported-c-code |
| [docs/integration/loading-xml-files.mdx](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/docs/integration/loading-xml-files.mdx) | loading-xml-files |
| [docs/integration/cmake.mdx](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/docs/integration/cmake.mdx) | cmake |
| [docs/integration/simulator.mdx](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/docs/integration/simulator.mdx) | simulator |
| [docs/integration/linux.mdx](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/docs/integration/linux.mdx) | linux |
| [docs/integration/zephyr.mdx](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/docs/integration/zephyr.mdx) | zephyr |
| [docs/integration/arduino-ide.mdx](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/docs/integration/arduino-ide.mdx) | arduino-ide |
| [docs/integration/renesas.mdx](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/docs/integration/renesas.mdx) | renesas |

## Figma 专项

| 固定版本源文件 | 主要主题 |
| --- | --- |
| [docs/figma/index.mdx](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/docs/figma/index.mdx) | index |
| [docs/figma/get-started.mdx](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/docs/figma/get-started.mdx) | get-started |
| [docs/figma/annotating.mdx](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/docs/figma/annotating.mdx) | annotating |
| [docs/figma/exporting.mdx](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/docs/figma/exporting.mdx) | exporting |
| [docs/figma/output-structure.mdx](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/docs/figma/output-structure.mdx) | output-structure |
| [docs/figma/updating.mdx](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/docs/figma/updating.mdx) | updating |
| [docs/figma/subjects.mdx](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/docs/figma/subjects.mdx) | subjects |
| [docs/figma/widget-support.mdx](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/docs/figma/widget-support.mdx) | widget-support |
| [docs/figma/troubleshooting.mdx](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/docs/figma/troubleshooting.mdx) | troubleshooting |

## 公开代码与自动化证据

| 固定版本源文件 | 主要主题 |
| --- | --- |
| [lvgl_widgets_xml/v9.5.0/lv_slider.xml](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/lvgl_widgets_xml/v9.5.0/lv_slider.xml) | lv_slider |
| [templates/empty/project.xml](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/templates/empty/project.xml) | project |
| [tutorials/sim/CMakeLists.txt](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/tutorials/sim/CMakeLists.txt) | CMakeLists |
| [.github/workflows/pr-check.yml](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/.github/workflows/pr-check.yml) | pr-check |
| [.github/workflows/compile_docs.yml](https://github.com/lvgl/lvgl_pro/blob/9380417dde7ec0a2aaae1063c95b7524342b6270/.github/workflows/compile_docs.yml) | compile_docs |

## 3. LVGL Open 底层证据

| 来源 | 核验内容 |
| --- | --- |
| [v9.5.0 MIT 许可](https://github.com/lvgl/lvgl/blob/v9.5.0/LICENCE.txt) | 图形库主许可 |
| [Observer C](https://github.com/lvgl/lvgl/blob/v9.5.0/src/core/lv_observer.c) | Subject 类型检查、更新与通知、观察者/对象生命周期实现 |
| [Observer H](https://github.com/lvgl/lvgl/blob/v9.5.0/src/core/lv_observer.h) | 对外类型和接口 |
| [v9.5.0 完整树 API](https://api.github.com/repos/lvgl/lvgl/git/trees/v9.5.0?recursive=1) | 当前 src/core/lv_observer 路径；src/others/xml 缺失的交叉验证 |

## 4. 结论到证据的快速映射

| 主要结论 | 直接依据 | 证据性质 |
| --- | --- | --- |
| XML/Design 编辑共同工程 | editor/overview.mdx | 官方功能描述 |
| Component prop 只在创建时传入 | syntax/components.mdx、api.mdx | 官方接口 |
| XML 定义驱动属性/枚举补全 | syntax/widgets.mdx、lv_slider.xml | 文档与文件 |
| 导出 C 不需要 XML 引擎 | integration/using-exported-c-code.mdx | 官方交付规则 |
| 运行时 XML 引擎不公开 | integration/loading-xml-files.mdx | 当前明确限制 |
| 真实 LVGL 预览与编译型扩展 | editor/overview.mdx、cli.mdx、images.mdx | 官方机制 |
| Emscripten 与预览编译链路 | pr-check.yml、v2.0.0、v2.0.5 | 可见工具链；具体桥接实现未公开 |
| Subject 不是 Pro 独占底层框架 | LVGL v9.5.0 src/core/lv_observer.c | 公开源码 |
| 表达式不响应状态更新 | syntax/evaluate.mdx | 明确语义 |
| 多 target 可运行或编译选择 | syntax/targets.mdx | 官方接口 |
| Figma 重导出不做三方合并 | figma/updating.mdx | 明确所有权规则 |
| Viewer 不能编译和保存 | online-viewer.mdx | 当前文档限制 |
| 截图缺失会自动建基线 | syntax/testing.mdx | 明确行为 |
| 架构分层与生成流水线 | 多项公开接口归纳 | 本报告推断 |

## 5. 没有被公开证据证明的事项

- 编辑器完整内部模块、完整源码开放范围以外的实现、JS/WASM 桥接和 Inspector 协议。
- 代码生成器 AST/IR、增量编译和缓存算法；相同 CLI 版本在不同宿主的字节级确定性。
- XML 引擎当前可获取版本、授权成本、设备 RAM 开销和解析性能。
- Viewer 私有数据驻留/保留策略、企业自托管能力；商业许可离线和并发细则。
- 任意 Figma 设计的全量无损转换、全部控件/渐变/自定义 C 的预览一致性。
- 真机性能、实际开发效率提升百分比以及产品级测试覆盖率。

## 6. 本次产物检查范围

本地检查包含 Markdown 文件间链接、固定提交来源路径、代码围栏配对、示意 XML 的标准格式，以及控件清单与基准目录一致性。标准 XML 格式检查不等于 Pro 语义检查；本次未使用商业 CLI token，未执行 Pro validate/generate/compile/test，也未执行硬件测试。

2026-10-15 检查结果：8 份 Markdown；17 处本地链接均存在；7 段 XML 通过标准解析器格式检查；29 个控件与基准目录一致；固定提交的源码文件链接均核对本地仓库路径；42 个官方技术文档 URL 的 HTTP HEAD 检查均返回 200。代码围栏成对。以上检查不包含完整 Markdown/Mermaid 渲染，也不构成产品功能实测。
