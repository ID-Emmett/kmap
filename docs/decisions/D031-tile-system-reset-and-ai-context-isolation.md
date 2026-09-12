# D031 — 冻结 V2 补丁链并建立瓦片子系统重置与 AI 上下文隔离

- 状态：Accepted
- 确认日期：2026-09-12
- 关联范围：T021 / T023 / T024 / T025 / T026 / T027 / T028 / Tile Runtime / AI Governance

## 背景

T021、T023 和 T025 均出现自动测试与真实浏览器脚本通过，但人工体验仍失败的情况。人工负责人明确反馈：初始化加载存在中心向外水波式补齐，pan/zoom 期间加载滞后，停止后继续出现请求波次，Tile 逐块显示，白闪仍存在，并且页面帧率和 pan 操作卡顿严重。

继续在 V2 上拆小补丁会扩大旧上下文污染风险，使 AI 会话更容易沿着已失败的 `TileEngineV2`、旧 coverage、旧 display 和旧 scheduler 语义继续局部修补。

## 决策

- 冻结 T026/T027 的 V2 补丁链，不再把它们作为默认下一步。
- T021/T023 的人工失败结论升级为正式阻断状态；不得用自动测试或截图覆盖。
- 新增 T028 作为瓦片子系统重置与 AI 上下文隔离入口。
- T028 完成前，不继续实现 T022/T019，也不继续扩大 TileEngineV2。
- 新瓦片路线必须先明确可信开源基准、源码映射、旧实现隔离墙、可复用边界和逐帧诊断验收。

## 保留边界

- 继续保留 KYE XYZ/MVT Source、Worker protocol v1、Polygon/Line geometry build、Three.js GPU upload、WebGPU/WebGL2、Map3D 0.1 公共 API 和资源 ownership，除非后续决策单独改变。
- T024/T025 作为失败路线中的局部证据保留，不作为继续补丁式推进的默认理由。
- 旧瓦片代码只能在任务上下文包明确允许时读取，用于失败证据、接口边界或迁移风险分析。

## AI 上下文隔离要求

- 新瓦片实施任务必须有 `Task Context Packet`。
- Forbidden Files 必须显式隔离旧 Runtime、旧 Display Coverage、旧 Motion Scheduler 和 TileEngineV2 补丁链，除非任务目标就是审计或删除旧代码。
- 实施会话不得默认读取旧任务全集、详细会话历史、完整 evidence 目录或旧瓦片源码。
- 任何需要突破隔离墙的实现行为，都必须停止并返回决策会话。

## 对应任务

- `tasks/T028-tile-subsystem-reset-context-isolation.md`

