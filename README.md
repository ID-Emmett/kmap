# Kmap 3D Map SDK

Kmap 是基于 TypeScript、Three.js 和 WebGPU 的地图 SDK，使用 pnpm workspace 管理 SDK 与 Playground。仓库：https://github.com/ID-Emmett/kmap。

## 当前能力

- XYZ MVT 加载、Worker 解码与面纹理绘制。
- GPU 道路线实例、视图线宽、渐进细化与祖先覆盖。
- 视锥与距离剔除、LOD、距离雾、有界并发与缓存回收。
- 平移、缩放、旋转、倾角交互与城市飞行预取。
- 性能面板、城市往返、首屏快速交互验收、手势录像与诊断导出。

默认使用 WebGPU，支持 Three.js WebGL2 回退。当前连续体验证据来自 WebGPU。文字、完整样式和业务图层属于后续范围。

## 开发

环境：Node.js ≥22.12、pnpm 11。依赖版本由 `pnpm-lock.yaml` 锁定。

```bash
pnpm install
pnpm dev
pnpm check
pnpm ai:check
```

Playground：http://127.0.0.1:5173/。生产构建使用 `pnpm build`。

## 目录

```text
apps/playground/       演示、性能面板与浏览器验收
packages/map3d/        @kmap/map3d SDK 与测试
scripts/              证据审查与治理检查
docs/                 架构、研究、知识和会话记录
tasks/                实施规格与历史任务
skills/               项目开发流程
```

SDK 入口为 `import { Map3D } from '@kmap/map3d'`。初始化示例见 [Playground](apps/playground/src/main.ts)，样式集中于 [mapStyle.ts](apps/playground/src/mapStyle.ts)。地图数据服务需提供可访问的 MVT 地址及相应授权。

## 架构与验证

- [当前架构](docs/architecture/nova-tile-engine.md)
- [实现与验证事实](docs/knowledge/streaming.md)
- [公开资料与验收定义](docs/research/streaming-rebuild-public-sources.md)
- [开发规则](AGENTS.md)

`pnpm check` 执行类型检查、测试及生产构建；`pnpm ai:check` 检查项目治理结构。录像、大型时序和图像保存在本地 `docs/evidence/`；Git 跟踪轻量索引和最终修复报告。
