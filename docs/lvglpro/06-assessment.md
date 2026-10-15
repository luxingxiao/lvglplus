# 06 · 版本、授权、风险与验证

## 1. 本次版本快照

核验时间：2026-10-15。GitHub Releases API 与发布页面共同显示：

| 项目 | 本次观察 | 解释 |
| --- | --- | --- |
| 最新稳定版 | v2.0.5，2026-10-14 10:32（北京时间，按 published_at 换算） | 本报告产品版本基准 |
| 预发布 | v2.1.0-beta0，2026-10-07 | 不作为稳定量产默认版本 |
| 公开仓库 master HEAD | `9380417dde7ec0a2aaae1063c95b7524342b6270` | 用于固定文档、示例及元数据证据 |
| 仓库示例 LVGL 基线 | `9.5.0` | 不是承诺任意 LVGL 版本兼容 |
| 官网下载区部分文字 | 仍写 Editor/CLI v1.2.1 | 与当前 release 不一致，需从 release 核对下载 |

2.0 引入或强化完整 Figma Flow、表达式、多个 target、资源占用分析、Design 模式与新授权方式。发布记录也提到 Theia 相关行为。2.0.5 支持优先尝试 PATH 中的 emsdk，但版本须匹配 4.0.6，否则使用受管理版本。完整变更应读对应 release，不能仅看官网首页。

来源：[Releases](https://github.com/lvgl/lvgl_pro/releases)、[v2.0.0](https://github.com/lvgl/lvgl_pro/releases/tag/v2.0.0)、[v2.0.5](https://github.com/lvgl/lvgl_pro/releases/tag/v2.0.5)、[官网](https://lvgl.io/pro)。

## 2. 已发现的文档冲突与采用原则

| 冲突 | 本报告处理 |
| --- | --- |
| 首页仍写 Figma 全屏同步将推出，2.0 Figma 文档已经描述完整 Flow | 依据版本明确的 2.0 Figma 文档说明现有能力，仍保留转换覆盖限制 |
| XML 规范旧页称 loader 按 MIT 自由使用，当前集成页称引擎不公开 | 不把历史 loader 条款当作当前引擎获取保证；以当前引擎说明为交付边界 |
| CMake 页列旧 component 清单，2.0.2 release 已更名 | 以实际安装版本生成文件为准 |
| 通用 binding 页列三种 Subject，release 增加 pointer | 分开描述 XML 常见类型、版本新增类型与底层 C 类型 |
| 定价口号“no per-seat fees”，表格又列 active seat 数 | 理解为主要按产品计价但套餐有并发席位约束，不写“无限商业席位” |
| Pricing 包含 Growth CLI，CLI 页只说 Product/Platform token | Growth 的 CLI 权限及 token 发放待供应商确认 |
| Online 页仍描述按仓库月/年订阅，2.0 商业体系转向按产品 | 功能权限以当前套餐/合同确认，旧订阅说法不作为采购依据 |
| Screens 页的子元素清单不含 animations，Animations 页明确支持 screen timeline | 以专门的动画页解释能力，记录文档不同步，不假设列举均完整 |

采用原则：具体版本发布说明与专项集成文档优先于泛化营销文字；可观察接口优先于从产品口号推断实现；无法解决的差异保留为待确认项。

来源：[Figma](https://lvgl.io/docs/pro/figma)、[XML 集成](https://lvgl.io/docs/pro/integration/loading-xml-files)、[XML 规范](https://lvgl.io/docs/pro/syntax/xml-license)、[CLI](https://lvgl.io/docs/pro/cli)、[Pricing](https://lvgl.io/pro/pricing)、[Online](https://lvgl.io/docs/pro/online-viewer)。

## 3. 授权分层

这里记录官方公开条款的产品事实，不替代合同解释。主要边界是：

| 层 | 观察到的边界 |
| --- | --- |
| LVGL Open 图形库 | v9.5.0 主许可为 MIT；所选第三方库仍应分别核验 |
| Pro Editor | Community 用于个人/开源，Evaluation 用于评估；实际商业开发需合适付费许可 |
| CLI | 专业能力，Community/Evaluation 不提供；token 具体套餐见前述冲突 |
| XML Specification | 应用固件与内部用途被允许；对外 UI 编辑器/生成器等使用另有书面授权限制 |
| 当前运行时 XML 引擎 | 文档说明不公开，需联系 LVGL 获取条件 |
| 导出产物 | 官方宣称为普通 LVGL C、无按设备费用/版税；工具再分发权另论 |

本次 Pricing 表显示：Community 免费；Growth 按产品定制报价、最多 2 个 active seats；Product 每产品 20,000 美元、最多 5 个 active seats、有效期最少 5 年；Platform 按协议。产品变体、商业用途、私有分享及支持也按套餐定义。金额是本次页面快照，后续采购须重新核对。**不能理解为每年 20,000 美元，页面列的是 per product。**

若拟基于 LVGL Pro XML 规范做对外工具，应单独核对 [XML Specification License](https://lvgl.io/docs/pro/syntax/xml-license) 对编辑器、转换器、插件和 SDK 的限制；“GitHub 仓库公开可读”不等于所有内容均可按 MIT 再利用。

来源：[MIT](https://github.com/lvgl/lvgl/blob/v9.5.0/LICENCE.txt)、[Editor License](https://lvgl.io/docs/pro/editor/license)、[定价](https://lvgl.io/pro/pricing)、[规范许可](https://lvgl.io/docs/pro/syntax/xml-license)、[XML 引擎](https://lvgl.io/docs/pro/integration/loading-xml-files)。

## 4. 核心技术风险

| 风险 | 触发条件 | 验证/缓解方法（建议） |
| --- | --- | --- |
| 预览与目标表现差异 | 色深、字体、配置、驱动或 renderer 不同 | 固定配置并对比目标截图；不要仅凭 Editor 通过 |
| 资源估算不足 | 只统计图片字体，忽略 framebuffer/堆/栈/缓存 | 用 map 文件、运行时高水位及峰值场景补齐 |
| C 扩展链路不通 | 自定义 Widget 只有元数据或解析器遗漏 | 验证 API、C 实现、parser、预览编译和目标链接全链 |
| 生成器版本漂移 | CLI 未固定版本、元数据与 LVGL 不匹配 | 固定依赖并审查生成产物 diff |
| Figma 覆盖或失同步 | FIGMA 文件手改，或 USER 文件期待后续自动更新 | 所有权约定、导出前提交、人工检查变更 |
| 多 target 体积超限 | 使用同一 binary 携带全部资源 | 比较编译选择与运行时选择的 map 及包大小 |
| Subject 生命周期/同步错误 | 指针过期、字符串缓冲释放、跨线程调用 | 应用统一状态入口、明确所有权与 UI 调度 |
| 视觉测试假通过 | 缺失基线自动创建、只检查截图无行为断言 | 基线审批、缺失检测、Subject 断言与设备用例 |
| 动态 XML 更新失败 | 固件 Widget/API 与资源包版本不一致 | 明确兼容契约、校验更新包、原子切换及回退 |
| 商业链路不可用 | 授权 token、离线环境或私有库访问受限 | 在实际 CI/网络条件下做授权与可用性测试 |

## 5. 应当执行的验证矩阵

| 验证项 | 建议实验 | 验收证据 | 本次状态 |
| --- | --- | --- | --- |
| 组件与接口 | API 参数/默认值/slot 多实例 | 生成 C、截图、无参数遗漏 | 未执行 |
| 实时绑定 | UI 与应用分别更新同一 Subject | 值与显示同步，页面重建行为正确 | 仅审查机制 |
| 自定义 Widget | 实现一个含内部 element 的 C 控件 | Editor 与固件构建通过 | 未执行 |
| 资源 | 中文、多字号、RGB565 透明图片、文件路径 | 字形正确、路径有效、颜色符合预期 | 未执行 |
| 多 target | 同工程两尺寸、两套资源 | 各 target 截图与二进制体积 | 未执行 |
| Figma | Auto Layout、state variant、数据绑定、再次导出 | 转换结果与 ownership 保留证据 | 仅审查文档 |
| CLI/CI | 授权安装、错误 XML、失败测试、截图 | 退出码、日志、基线和失败产物 | 未执行 |
| 生成稳定性 | 同版本重复生成并 compare | 规范化内容一致 | 未执行 |
| 真机性能 | 最复杂页面与切换动画 | FPS、延迟、峰值堆、Flash、总线负载 | 未执行 |
| XML 动态加载 | 正确/缺失/损坏资源与版本不匹配 | 可恢复失败、不悬空、不泄漏 | 引擎未获取 |

指标阈值应由产品目标给出，不能用官方“即时”“pixel-perfect”“节省开发时间”等表述代替测量。尤其开发效率百分比没有在本次调研中独立复现。

## 6. 选型判断与可借鉴点

适合优先评估的场景：已有 LVGL 产品、屏幕和变体较多、设计与开发需要频繁交接、能接受 XML 与 C 扩展混合、希望引入 UI 回归流水线。

简单少页面且人员很少的项目，工具成本和组件建设投入可能高于收益。高度自绘/GPU/3D 界面需要先验证 Widget 与预览工具链；强离线或有数据驻留约束的项目，应确认授权、字体获取、Viewer 与 MCP 的网络边界。

对工具链自研最值得借鉴的通用设计包括：受控组件 API、共同文本工程、元数据驱动补全、真实引擎预览、生成/用户文件分离、设计导入所有权、状态绑定、版本化视觉基线。这些是架构原则；是否复用 LVGL XML 具体规范和实现应按其许可另行判断。

## 7. 需要供应商回答的问题

1. CLI 在 Growth/Product/Platform 下的准确权限、token 生命周期、离线使用、CI 并发及版本归档策略。
2. 当前 XML 引擎的获取、源码/二进制形式、授权、支持版本、内存开销和长期维护安排。
3. Pro、LVGL 与 widget XML 的正式兼容矩阵，以及生成代码的 ABI/API 兼容策略。
4. Viewer 私有工程的数据处理、缓存、日志保留、访问撤销、部署区域及是否支持企业自托管。
5. Figma 不支持效果/控件的准确清单、转换失败诊断与版本间迁移方式。
6. 产品与变体定义、active seat 计算方式、五年有效期/更新/支持的合同边界。

这些问题仅列为后续评估项，本次未向供应商发送消息。
