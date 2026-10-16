# Rider：零项目 C 控件的声明式能力示例

本示例独立编写，展示 XML + Model 能否覆盖复杂仪表所需的通用构件，不包含 Rider Radar 的源码或素材。它没有 `native.sources`，不需要手写 C 控件或字体注册代码。

```sh
# 在仓库根目录，先完成 README 的依赖引导与标准 build。
node packages/cli/dist/main.js build examples/rider --wasm
node packages/cli/dist/main.js dev examples/rider
# 三条路径的一致性验收：
pnpm test:declarative
```

- 三种视图：基础仪表、8 个雷达目标、10 人团队和曲线路网。
- 右方向键/Screen 切换视图；上/下选择；雷达内 Enter 打招呼；Esc 返回。
- 六个消息按钮、三角色、剧情编号、暂停/继续和倍速。
- C VM 计算模拟运动、投影、连通分量聚类、中心和 fitScale；快照由 C 调度器每 1/2 秒原子提交。
- 字体通过 manifest 声明，来自固定 LVGL 依赖的 Montserrat 与 Source Han Sans；原字体许可证仍在依赖中。生成字库与全部构建产物在 ignored `.lvglplus/`。

当前地图为本地示意路网；角色改变观察位置和方向，不重置世界。示例尚未包含原应用的全部告警、筛选、隐私、云通信及视觉细节。原项目的 Linux/noVNC 测试通过记录不是本示例的通过证明。这里没有真实 CAN 或 MCU 实机验收。

规范、预算与设备集成要求见 [声明式能力文档](../../docs/lvglplus/declarative.md)。
