# XML、IR 与包格式 v1

## 工程入口

`plus.project.json` 必填字段：`formatVersion: 1`、C 标识符形式的 `name`、`lvglVersion: "9.5.0"`、`ui`、`model` 和非空 `targets`。每个 target 有 `name/width/height`，尺寸为 1–4096。`sources` 为可选数据源配置文件。路径相对工程根；服务端拒绝逃逸根目录的路径和符号链接。

## Model 与 ViewModel

```xml
<model version="1">
  <signal name="vehicle.speed" type="number" initial="0" unit="km/h" timeoutMs="1500"/>
  <signal name="settings.enabled" type="boolean" initial="false"/>
  <computed name="vm.speedMph" type="number" expression="vehicle.speed * 0.621371"/>
  <command name="enable" target="settings.enabled" value="1"/>
  <command name="deviceRequest"/>
</model>
```

类型：number（C double）、integer（int32 范围）、boolean（0/1）、string（最多 255 UTF-8 字节）、enum（零起始索引，`choices="park|drive|reverse"`）。`computed` 为只读数值/布尔派生值，全部依赖拓扑排序；循环、缺失引用和任意代码执行均拒绝。

表达式支持算术、比较、`!`、`&&`、`||` 和三元。AND/OR/三元短路；除零、溢出或结果类型不匹配令派生信号质量变为 INVALID，保留旧值。表达式最多 128 token、96 条指令和 24 层嵌套。字符串通过绑定 format 格式化，不支持字符串表达式。

本地 command 修改明确指定的可写数值信号。无 target 的 command 交给应用处理器；不存在处理器时失败，不能假定发送成功。设备确认通过 request ID 的完成接口回写。

## View

```xml
<dashboard version="1" start="home">
  <styles><style name="heading" color="#e9f2ff" fontSize="28"/></styles>
  <page id="home" bg="#0b1220">
    <text id="speed" style="heading" x="40" y="40">
      <bind property="text" signal="vehicle.speed" format="%.0f km/h"/>
    </text>
  </page>
</dashboard>
```

节点：panel、text、button、bar、slider、arc、switch、image。Page 编译为顶层 panel。显式 ID 保持稳定；省略时使用结构路径生成，重新排序后可能变化。总计最多 512 个节点、256 个信号。

主要属性：x/y、width/height（像素、百分比、content）、bg/color/borderColor（`#RRGGBB`）、radius/padding/gap、direction（row/column）、align、textAlign、fontSize、text、min/max/value、hidden、opacity、grow、navigate、startAngle/endAngle。基础字号为 14/20/28/40/48，不能据此认为任意 TTF 或中文字体已支持自动转换。

Image 的 `src="A:images/logo.png"` 对应工程内 PNG 文件。Studio 按显式引用读取并放入 WASM 虚拟文件系统，单文件最多 2 MiB，总量 8 MiB；设备端需提供对应 LVGL 文件系统路径。原生 runner 从工程根运行。二进制包只含路径，不内嵌图片。

## 组件与插槽

```xml
<component name="card">
  <param name="title" default="Status"/>
  <panel width="200" height="100">
    <text text="${title}"/>
    <slot name="content"/>
  </panel>
</component>
```

实例为 `<use component="card" id="status" title="Battery"><fill slot="content">...</fill></use>`。参数为创建时文本替换，之后进入普通类型校验；不会执行字符串中的代码。组件只有一个根对象，不允许递归引用。Slot 可以有默认 children。组件实例内节点 ID 带实例前缀。

## 绑定与事件

- `text`：text/button，支持一个 `%d`、`%s` 或 `%.Nf`，literal percent 写 `%%`。
- `value`：bar/slider/arc；`checked`：switch；`hidden`：对象隐藏；`color`：24 位文字颜色。
- `quality`：text/button 显示 LIVE/STALE/INVALID/OFFLINE。
- `direction="two-way"` 仅用于 slider/value 的可写数值或 switch/checked 的可写布尔。应用更新不再回写成用户事件。
- `<on event="click" command="..."/>` 当前用于按钮。`navigate="pageId"` 切换已有页面。

无效信号的文字绑定显示 `--`，数值控件降低不透明度但保留最后值。所有页面当前随 UI 创建；导航保留各页状态，按需创建/销毁页面留待后续优化。

## 公共 IR

IR 含 formatVersion、name、lvglVersion、targets、signals、evaluationOrder、commands、pages 和 initialPage。节点含稳定 id、kind、props、bindings、children 以及源码位置。C 与包输出的同一套属性解释规则位于 C renderer。

## 二进制包

包使用 little-endian，魔数 `LVP1`，随后是版本、尺寸、初始页面、信号定义/指令、求值顺序、命令和前序扁平节点。字符串为 uint32 字节长度加 UTF-8 数据；数值为 IEEE754 float64；父索引小于子索引，顶层使用 UINT32_MAX。

读取器限制总包 8 MiB、字符串 4096 字节、信号/节点/绑定/指令数量，校验版本、索引、核心类型与绑定形态，并拒绝截断/尾随数据。格式仍处于 0.x，升级必须修改显式版本或提供迁移；不支持把未知新格式静默当作旧格式加载。


0.2.0 扩展：公共 IR/二进制包为 v2，XML/project 仍为 v1；翻译、动画、自定义控件和字体语法见 [P3–P5](p3-p5.md)。SDK 同时接受旧 v1 包；旧运行时会拒绝新 v2 包。
