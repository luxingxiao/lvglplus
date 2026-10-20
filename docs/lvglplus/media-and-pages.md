# 通用资源、媒体与页面生命周期（IR v4 / SDK ABI 3）

本轮能力用于具有多页面、主题、图片数字、序列动画及外部媒体帧的应用。实现、公开夹具和测试均不包含任何特定仪表的素材、布局或协议。XML/project 仍为 v1；新输出为 IR/包 v4、bundle SDK ABI 3。当前 SDK 继续读取 v1–v3；旧运行时拒绝 v4。

## 有界资源表与图片序列

```xml
<image id="status" x="20" y="20">
  <source src="A:assets/idle.png"/>
  <source src="A:assets/running.png"/>
  <bind property="source" signal="statusIndex"/>
</image>
<image id="activity">
  <source src="A:assets/frame0.png"/>
  <source src="A:assets/frame1.png"/>
  <sequence frameMs="50" repeat="-1"/>
  <bind property="playing" signal="playing"/>
</image>
```

`source` 是零起始数值索引，不接受任意字符串文件名。每张图最多 512 项，路径必须是工程内 PNG；CLI、Studio 服务、Viewer 与 bundle 都收集全部引用、去重、检查路径和文件。上传/删除保护与热更新也覆盖资源表。

非法索引、非整数或失效质量保持该对象最后的图片；对象销毁后重建时重新使用静态初始图片，然后应用当前有效绑定。`src` 可指定初始图片，省略时使用第一个 source。资源表与序列文件均由应用提供；不提供特定第三方资源格式的解析器。

`sequence` 每帧 1–3600000ms，repeat=0 播放一次，正值为额外重复次数，-1 无限循环。结束停在最后一帧；暂停和隐藏不推进播放时间，恢复继续，UI 时钟回退重新计时。源索引绑定与自动序列不能同时声明。序列按时间直接选择当前帧，不排队补播落后的画面。

## 多关键帧动画

```xml
<panel id="indicator" width="20" height="20" bg="#60b0ff">
  <keyframes property="x" repeat="-1">
    <key atMs="0" value="0"/>
    <key atMs="600" value="100" easing="cubic-bezier" control="0.25,0.1,0.25,1"/>
    <key atMs="1200" value="0" easing="ease-in-out"/>
  </keyframes>
</panel>
```

支持 x/y/opacity/value/rotation/scaleX/scaleY，2–32 个键，首键必须为 0ms，时间严格递增且不超过一小时；repeat 语义同上。每个目标属性可以形成独立轨道，不能同时绑定或使用旧 animate。段尾 key 的 easing 作用于该段；支持 linear、ease-in-out、step、ease-in、ease-out 和 cubic-bezier。贝塞尔横向控制点在 0–1，纵向控制点在 -8–8。所有路径共用 C 求值，使用 UI 动画时钟；`lvp_ui_restart_animations` 重启动画。

这不是任意脚本或通用第三方动画文件播放器。需要将外部动画转为这些受限轨道、序列帧或应用自定义控件。

## 页面驻留、导航与模态输入

```xml
<page id="home" lazy="true" retain="false" pageSignal="screenIndex">
  <panel id="confirmation" modal="true" priority="100">
    <bind property="hidden" signal="dialogHidden"/>
    <input action="back" command="dismiss"/>
  </panel>
</page>
```

`lazy=true` 延迟创建页面对象，`retain=false` 离开后销毁并取消订阅。未驻留的对象 bounds 返回 RANGE；模型继续存在，返回时读取最新值。默认保持旧版的立即创建和保留行为。节点定义仍保存在 schema，懒加载减少的是 LVGL 对象、订阅及页面私有媒体占用，不会消除 schema/字库/文件的存储成本。

`pageSignal` 通过数值索引选择声明顺序中的页面；通常将所有页面连接到同一个 computed 路由信号，电源/权限等规则在应用模型中处理。无效或越界索引保留当前页面。声明式路由会在 tick 时重新选择模型要求的页面；不要将它与独立的命令式导航栈作为两个同时写入的路由来源。

命令式宿主可调用 `lvp_ui_navigate`、`lvp_ui_push`、`lvp_ui_back`。栈最多 32 项，目标创建失败不入栈、不替换原页面。`lvp_ui_set_lifecycle` 观察 create/enter/leave/destroy；观察回调必须保持同步且不能重入导航、销毁或热更新。

可见模态 panel 优先消费语义输入，priority=0–255；同优先级后声明的优先。未声明相应 input 时阻止向页面穿透。`input` 子节点支持应用自定的有界动作名，适合 long-press 等由输入适配器生成的语义。图片、panel、button、custom 可绑定 click 命令。模态视觉布局由应用组合，并不内置任何产品弹窗规则。

## 外部媒体帧与应用宿主

`lvp_ui_frame(ui,node,pixels,length,width,height,stride,format)` 向已创建的 image 提交完整 RGB565 或 BGRA8888 图像。接口校验尺寸、长度和步长，复制输入，返回后调用方可释放；失败保留旧帧。图片对象/页面销毁释放帧与缓存。所有调用必须在 UI 线程进行；协议线程仅投递数据或将解码帧交给宿主队列。

该接口不提供视频解码器、网络协议、音频、DRM、硬件 DMA 或跨线程 LVGL 操作。应用可以将系统解码器、文件回放或设备媒体服务的帧接入同一渲染器。没有使用一个项目控件来假装平台已支持所有媒体后端。

`lvp_register_application` 注册持久描述符，每个 UI 有独立的 open/tick/close 状态。open 成功后由宿主调用 tick，销毁前 close；初始化失败应由 open 清理自身未交付的状态。使用既有命令处理器和类型化 Model 连接业务。预览、native runner、生成 C 均执行相同应用生命周期。自定义应用源码仍通过显式 `native.sources` 构建，浏览器继续使用工具自身可信 JS glue，不能导入项目 JavaScript 替代工具运行时。

## 字体与资源预算

每个进程最多注册 64 个字库；manifest 字体声明仍要求合法名字、8–160px 与有限字符子集。应用应按实际需要裁剪、复用字体，不能将字体上限理解为设备已经具备对应内存。

默认项目仍为 512 节点、256 信号、8 MiB PNG 文件总额和 64 MiB 全量解码面积估计。更大的工程必须显式声明：

```json
{"limits":{"nodes":2048,"signals":512,"resourceBytes":33554432,"decodedBytes":134217728}}
```

硬上限为 4096 节点、1024 信号、128 MiB 文件总额和 512 MiB 解码面积估计；单 PNG 上限仍为 2 MiB。编译器/加载器保留有界校验。全部 source 都计入预算并去重；解码面积合计不等于同时驻留内存，字体、模型、图层和堆碎片亦不包含在内。`lvp_ui_resident_nodes` 报告当前驻留的 schema 节点数量，控件内部对象不计入。

原生构建输出改为各工程 `.lvglplus/native`，避免并行工程的字体或自定义源码相互覆盖。WASM 构建继承选定 Python 解释器，CLI 使用工具环境的 Python，避免不同工作目录命中不兼容的系统版本。

## 验收

- `pnpm test`、`pnpm test:c`：编译、格式兼容、模型及通用功能。
- `pnpm build:wasm`、`pnpm test:render`：既有渲染/热更新一致性回归。
- `pnpm test:media`：资源索引、非法索引保持、序列暂停/恢复、关键帧、懒加载重建和透明层，native/生成 C/WASM 精确像素一致。
- `ctest` 的 `ui-media`：导航栈、模态输入、生命周期、100 次销毁/重建、帧复制及长度拒绝；可启用 ASan/UBSan。

上述为软件验证。外部媒体解码、真实输入驱动、交叉编译目标与真实硬件仍由具体应用单独验收。
