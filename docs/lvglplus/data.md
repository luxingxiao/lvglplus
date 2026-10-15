# 数据接入与车辆仪表

## 分层契约

Transport 负责帧/连接；Codec 负责协议字段；Mapping 对应领域信号；Model 保存类型化值和质量；ViewModel 派生显示状态。UI 只绑定模型名称，不依赖 CAN ID、串口或 DBC。

Studio 的标准事件形态为 `signal/value/timestampMs/quality`。质量为 valid、stale、invalid 或 disconnected。它是开发工具的 JSON 桥接接口；设备内对应 `lvp_value`，不需要 JSON。

## sources.json

```json
{
  "simulation": { "vehicle.speed": { "min": 0, "max": 120, "periodMs": 18000 } },
  "replay": "drive.jsonl",
  "dbc": "vehicle.dbc",
  "mappings": { "DriveStatus.Speed": "vehicle.speed" }
}
```

模拟支持 sine 和 toggle，周期不得小于 20ms；整数/枚举舍入，布尔转换为 0/1。它不负责产生应用真实物理模型。

## 录制格式与回放

JSONL 每行 `{ "atMs": 500, "values": { "vehicle.speed": 20 } }`，相对时间非递减，只允许写可写 Model 字段。Replay 支持 seek、reset、pause 和 0.1–16 倍速。Seek 重建从初始值至指定时刻的状态，不保留“未来”值。

Studio 回放使用相对回放时间作为模型时钟，暂停时不继续推进超时；模拟和 CAN 使用当前毫秒时间。切换源会显式标记外部信号离线，避免把上一个源的数据当作新源的有效测量。切换信号源不会更改页面 XML。

JSONL 是当前回放输入格式。直接把 CAN 帧日志转为映射后 JSONL 的工作流可由外部脚本完成；Studio 尚未提供自动录制按钮或全部厂商 CAN 日志格式导入。

## DBC → C

`generate` 调用构建期 Python/cantools，输出带 MIT 声明的 `database.c/h` 与 Plus 的 `lvp_dbc.c` 映射包装。wrapper 在发布信号前检查帧长度和所有映射字段范围，避免半帧更新。标准/扩展 ID 明确区分。

支持 cantools 可生成的数值、大小端、符号、缩放偏移和单层复用分支。嵌套/多个 mux selector 明确拒绝。当前映射发布数值，DBC enum 的标签不会自动替代 Model enum 的索引约定；需要使用与 Model 一致的数值定义。

## Linux SocketCAN

```sh
sudo modprobe vcan
sudo ip link add dev vcan0 type vcan
sudo ip link set vcan0 up
node packages/cli/dist/main.js build examples/vehicle --gateway
```

Studio 选择 CAN / FD。也可直接运行 `.lvglplus/gateway/lvp_can_gateway vcan0` 查看 NDJSON。接口需预先配置；真实 CAN 的位率、CAN FD 数据位率和收发器由 Linux 管理。

网关接收 Classic 和 FD，排除 RTR/error 帧，对错误长度发出 decode-error。服务把错误反映为数据质量，断线使用有上限退避重启网关。示例不发送车辆控制帧。

## 嵌入式接入

将生成 codec 链入固件。接收帧先构造 `lvp_can_frame`（长度是字节数，不是 DLC），调用 `lvp_dbc_decode`，在 emit 回调中按名称查信号并通过 `lvp_post` 入队。UI 线程调用 `lvp_tick`。

输入队列默认容量 32，可通过 HAL 配置；需要多线程时提供锁。状态值可合并；事件数据用 `is_event=1`，满时返回 `LVP_FULL`，由调用者重试/持久化/计数，绝不表示无限可靠投递。`lvp_stats` 提供 posted/processed/coalesced/overflow/pending。

## 当前协议边界

首版提供模拟、回放、CAN/DBC；UART framing、Modbus、MQTT、UDS/J1939 不是现有实现。Transport-neutral CAN envelope 和标准信号事件为后续协议复用边界，不把空接口称为协议已经适配。
