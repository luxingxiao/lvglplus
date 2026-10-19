# 通用声明式仪表能力（IR v3 / SDK ABI 2）

本轮将复杂仪表所需能力加入 Plus 自有语言和公共 C 核心。应用可以组合 XML、类型化 Model 和数据配置，无需手写自定义 C 控件。公开渲染验收使用独立几何夹具 `tests/fixtures/graphics`；应用级验证源码保存在本地忽略目录，不随仓库发布。

## 开始

```sh
pnpm install --frozen-lockfile
python3 scripts/bootstrap.py --wasm
pnpm build:wasm
pnpm build
node packages/cli/dist/main.js dev tests/fixtures/graphics
```

Studio 聚焦画布后可向工程声明的语义输入发送事件。真实 LVGL 画面来自 C/WASM，不用浏览器重新实现绘制或业务求值。

生产路径仍为生成 C 数据定义 + Plus C SDK + LVGL。应用新增的 XML/Model 不引入设备 XML 解析器。生成字库也是工具产物，不要求应用作者编写 C 注册代码。

## 图形与动态属性

新增内置 `path`、`polygon`、`sector`、`grid`，由公共 LVGL 适配层实现。既有 `custom` 扩展方式仍可用，但示例没有 `native.sources`。

| 控件 | 属性与语义 |
| --- | --- |
| path | `points="0,0 20,20 40,0"`；2–64 个局部坐标点；`curve="linear\|catmull-rom"`；后者每段细分 12 次 |
| polygon | 同样的 points，闭合轮廓和填充；有界耳切支持简单凹多边形；退化、自交多边形没有定义的填充效果 |
| sector | 椭圆扇区；`startAngle/endAngle` 为度，0 度向右、正角顺时针；跨度限制为正负 360 度；可设 `fade="true"` 做角向拖尾 |
| grid | `gridX/gridY` 为间距，最小 2px；`color/lineWidth` 控制网格 |

图形使用 `color` 作轮廓色，`bg` 作多边形/扇区填充色；`lineWidth` 最大 64px。路径支持 `dashLength/dashGap`。扇区使用平滑 A8 覆盖缓存，见文末资源契约。几何保存在适配层，不进入 LVGL-free 数据核心。

通用静态属性新增：`rotation`、`scaleX/scaleY`、`pivotX/pivotY`、`clip`、`bgOpacity`、`bgEnd`、`gradientDirection`。缩放采用 LVGL 的 256=1× 单位；旋转单位为度。透明组合使用 `bgOpacity="0"`，组合 panel 实现分层；子元素顺序决定绘制顺序，`clip="false"` 显式允许溢出。

```xml
<path id="route" width="280" height="320"
      points="10,300 80,220 120,150 240,30"
      curve="catmull-rom" color="#6ee7b7" lineWidth="4"
      dashLength="10" dashGap="5">
  <bind property="p1x" signal="route.middleX"/>
</path>
<polygon id="heading" width="24" height="30"
         points="12,0 22,28 12,20 2,28"
         pivotX="12" pivotY="15" bg="#6ee7b7">
  <bind property="rotation" signal="headingDegrees"/>
</polygon>
```

除原六类绑定外，支持 x/y、width/height、rotation、scaleX/scaleY、opacity、bg、startAngle/endAngle、lineWidth，以及 `p0x/p0y` 至 `p63x/p63y`。点绑定必须落在已声明的 points 中。动态几何使用数值，失效时保持上一有效属性，不能将无效值当零移动对象。位置范围限制在正负 32767；透明度限制到 0–255。

`bind expression="..."` 在编译期降低为私有 computed 信号，所有端执行相同字节码，不是 JavaScript。节点和生成信号均计入工程预算。

## 有界集合、重复模板和查询

```xml
<collection name="members" capacity="10">
  <field name="x" type="number"/>
  <field name="y" type="number"/>
  <field name="online" type="boolean" initial="true"/>
  <computed name="displayX" expression="members.${index}.x * 0.5"/>
</collection>
```

集合容量为 1–64，字段降低为 `members.0.x` 等类型化信号。C、网关和模型注入仍通过已有读写/批量接口访问这些名字。稳定槽位用于成员身份；隐藏空槽位，不在设备端无界分配对象。数据源必须先把外部身份映射到稳定槽位。

```xml
<repeat collection="members" id="marker">
  <panel id="body" width="30" height="30">
    <bind property="x" signal="${item.displayX}"/>
    <text id="index" text="${index}"/>
  </panel>
</repeat>
```

也支持 `<repeat count="8">`。模板中的 `${index}` 是编译期索引；`${item.field}` 降低到对应槽位字段。所有展开节点带确定性 ID，重复模板子节点不会因相同 authored ID 冲突。可视化修改应修改模板，不能把生成槽位当作独立源节点编辑。

数值集合查询：

- `sum(members.online)`、`minimum(members.x)`、`maximum(members.x)`：有界编译期展开。
- `at(members.x, role)`：动态数值索引，降低为有边界检查的短路选择；越界或非整数索引产生 INVALID，未选分支不求值。
- `clusterId(members,0,34)`、`clusterSize(...)`、`clusterX(...)`、`clusterY(...)`：基于 x/y 的距离图连通分量，半径内连接具有传递性；组 ID 是最小槽位，中心为算术平均。索引和半径是声明中的常量，坐标随 Model 动态改变。
- `fitScale(members,250,290,0.5,1.2,20)`：根据 x/y 包围盒、视口宽高、最小/最大比例和总 padding 计算倍率。结果为 1=原比例，绑定 LVGL scale 时乘 256。

集合的字符串字段可以做普通文字绑定，但查询、快照和数学归约目前面向数值字段。它们是受限结构化集合，不是任意对象图或任意长动态列表。复杂展开超过字节码/信号预算会报编译错误。

## 数学、投影和数据质量

共享 C VM 增加 `sin/cos/atan2/hypot/sqrt/abs/floor/ceil/min/max/clamp`；三角函数使用弧度。支持十六进制数值常量，可用于动态颜色。

```xml
<computed name="screenX"
 expression="140 + (peerX-egoX)*cos(heading) - (peerY-egoY)*sin(heading)"/>
```

表达式仍禁止任意脚本、递归和用户循环。上限改为 512 token、256 条指令、24 层解析嵌套；VM 栈为 256 项。除零、非法平方根、非有限值、非法索引或目标类型不匹配会产生 INVALID/动作失败。集合空间运算依赖所有输入点的质量；无效成员应通过上游槽位策略处理，不会自动过滤。

## 原子动作、参数和状态机

```xml
<action name="send" parameter="integer"
        guard="arg() &gt;= 0 &amp;&amp; arg() &lt; 6">
  <set target="lastMessage" expression="arg()"/>
  <set target="messages" expression="messages+1"/>
</action>
```

动作自动成为可调用命令。`parameter` 可为 number/integer/boolean；未声明参数的动作不可使用 `arg()`。C API `lvp_command_number(ctx,"send",2)` 传递参数；返回的 request ID 仍通过 `lvp_command_state` 查询完成/失败。

动作须在数据批次提交后、Model 通知回调之外调用；未提交批次或通知过程中的动作返回失败，以免读取不一致的派生状态。所有匹配动作先检查参数、guard、RHS、数据质量、目标类型和写入冲突，再在同一批次提交。所有 RHS 读取动作前同一状态，支持交换两个字段。任何失败均不部分写入；没有匹配 guard 也返回失败。外部设备命令仍需注册处理器并显式确认，不能用本地动作代替真实设备回执。

按钮可以声明 `<on event="click" command="send" argument="2"/>`，或通过 `argumentSignal="selectedMessage"` 从有效数值信号读取参数；二者互斥。字符串/复合参数尚不支持。

```xml
<machine name="screen" initial="home">
  <state name="home"><on event="next" target="radar"/></state>
  <state name="radar"><on event="next" target="home"/></state>
</machine>
```

机器降低为 `state.screen` 枚举和受状态 guard 保护的原子动作。转移内可添加 set，转移和业务修改一起提交。支持多个独立平面状态机；不提供层级 statechart、隐式级联和无限转移。每个 state 内同一个 event 只能声明一次。

## 时钟、定时器和快照

```xml
<clock name="sim" running="running" rate="rate"/>
<timer clock="sim" intervalMs="1000" command="step"/>
<snapshot name="visible" collection="members" fields="x,y,online"
          clock="sim" intervalMs="2000"/>
```

clock 生成 writable number `sim.ms`，running 引用 boolean，rate 引用数值信号；缺省分别为运行与 1×。运行时倍率范围为 0–100，非法倍率暂停推进。首个 tick 建立锚点，不将系统 uptime 当模拟时间；UI、native runner 和设备只需传入单调毫秒时钟。

定时动作按截止时间顺序执行；执行前推进所有时钟和派生值，再运行命令。一次 tick 最多执行 32 个定时事件；超额保留逻辑时间和截止时间，后续 tick 继续执行，不静默合并或丢弃。`lvp_timing` 暴露 fired/failures/deferred。持续超载可能导致模拟时间落后，应用必须观察 deferred 并调整负载。

snapshot 降低为相同容量的只读用途槽位、`visible.sequence`、复制动作及定时器；当前槽位在 SDK 中仍是 writable，允许测试注入，并不是新的只读类型。所有字段和序号原子提交，定时采样读取截止时刻的派生值；一次推进 350ms 与分次推进到 350ms 的最后 100ms 快照都来自 300ms。快照字段限数值类型，每次最多 128 个写入（包括序号）。

暂停 clock 会冻结该 clock 的扫描/快照；不同 clock 可以独立暂停。将 clock.ms 重置为较小值会重建相关定时截止时间。热更新保留兼容 Model（含 clock.ms/state/快照），调度器重新建立截止时间，不保证保持旧包定时器的亚周期相位。

## 字体和资源

工程 manifest 可声明：

```json
{"fonts":[{"name":"digits","file":"builtin:montserrat","size":116,"characters":"0123456789"}]}
```

最多 16 个字体；size 8–160px；characters 1–8192 字符。file 支持工程内字体、`builtin:montserrat` 和 `builtin:cjk`；内置字体来自 bootstrap 固定的 LVGL 依赖和原许可证。工程字体路径不能逃逸根目录。

工具链调用固定版本 lv_font_conv，写入 `.lvglplus/fonts`，自动生成注册代码，并分别链接进 native/WASM。XML 使用 `font="digits"`。改字库需重新执行项目 `build --wasm` 并重新加载浏览器，不是 XML 热更新；Viewer 使用项目 WASM，字体已经编译其中。设备宿主也必须链接这些生成字库并在创建 UI 前调用生成的 `lvp_register_project_fonts`。生成 C 代码不等于字体已经安装在任意设备。

## 兼容与资源限制

- XML/project 入口仍为 v1；公共 IR/包升级到 v3；SDK ABI 为 2。新加载器接受 v1/v2 旧包，旧运行时拒绝 v3。原生应用需重新编译 SDK 和生成文件，不能混用旧 C ABI。
- Bundle 容器仍 v1，新 bundle 标记 SDK ABI 2；manifest、二进制头和 IR 版本必须相符。文件校验不代替产品传输认证。
- 上限：256 信号、512 节点、128 动作、每次命令最多 128 个写入、8 clocks、32 timers、64 几何点、字符串 255 UTF-8 字节。展开后的全部对象、计算和字库都消耗目标资源。
- 不包含任意 SVG、地图瓦片服务、富文本引擎、层级状态图或任意脚本运行时。复杂路径和透明层的设备性能需要实测。

## 验证

```sh
pnpm test
pnpm test:c
pnpm build:wasm
pnpm test:render
pnpm test:extensions
pnpm test:declarative
```

公开验收脚本比较静止、旋转和反向角度三类几何场景的 Model、质量、对象边界和完整像素，覆盖 native 包解释、生成 C 与 WASM，并验证透明区域和渐变色阶。原始证据写入 `tests/fixtures/graphics/.lvglplus/parity`（Git 忽略）。本地应用验证不再作为公共 CI 的依赖。

## 平滑扇区渲染

`sector` 使用逐像素 A8 覆盖图，替换固定 5° 三角形色阶。圆弧和角边界使用 2×2 子像素覆盖采样；角度正负、跨 0°、完整圆及零跨度均有定义。正跨度顺时针，负跨度逆时针，透明度从 start 向 end 增加。`fade="false"` 使用恒定 headOpacity。

| 属性 | 范围 / 默认 | 作用 |
| --- | --- | --- |
| tailOpacity | 0–255 / 0 | 拖尾起点透明度 |
| headOpacity | 0–255 / 255 | 前沿透明度 |
| fadePower | 1–8 / 1 | 角向衰减指数，越大越集中于前沿 |
| radialOpacity | 0–255 / 255 | 外缘相对于内缘的透明度，径向线性插值 |
| innerRadius | 0–99 / 0 | 内圈半径百分比，可绘制环形扇区 |
| rasterSize | 32–512 / 512 | 缓存宽高各自的上限，超出时缩放显示 |

以上属性为静态 sector 属性；startAngle/endAngle、对象 rotation/opacity/bg 仍可绑定。缓存不含颜色；颜色、位置、透明度和旋转变化复用覆盖图。角度或覆盖参数变化时重建，尺寸变化只在实际缓存尺寸变化时重建。每个扇区稳态占用 `min(width,rasterSize) × min(height,rasterSize)` 字节覆盖内存；事务重建短暂同时保留新旧两张图，另有 LVGL 图层/变换开销。较低 rasterSize 减少内存但降低精度，MCU 必须按实机预算设置。分配失败记录 LVGL 警告并跳过该扇区绘制，后续绘制会重试；不偷偷降级为分块效果。

```xml
<sector id="sweep" width="320" height="320" bg="#30e8ad"
        startAngle="0" endAngle="65" fade="true" fadePower="2"
        tailOpacity="0" headOpacity="255" radialOpacity="100"
        innerRadius="4" rasterSize="320" pivotX="160" pivotY="160">
  <bind property="rotation" expression="clock.ms*0.06"/>
</sector>
```

示意中的 clock 必须在 Model 中声明。扫描命中、目标回波寿命属于应用 Model 逻辑，本次没有引入专用雷达业务控件或声称已实现回波模型。完整物理发光/模糊、任意遮罩和真实设备帧率仍不在本次验收范围。

## 完整组合示例

[微电网能源控制台](../../examples/energy-console/README.md) 将环形渐变、旋转图层、动态曲线、集合、裁剪、告警和语义输入组合为 1024×600 的完整界面，不含应用 C 源码。运行 `pnpm test:energy` 可验证七类场景三路径一致性。
