# T001 Bootstrap nova Monorepo

## Goal

创建 Nova Monorepo 工程骨架、最小可运行 SDK/Playground 和长期 AI Coding 基础设施。

## Scope

- pnpm workspace 与 Vite 构建体系。
- `@nova/map3d` 和 `@nova/playground`。
- Three.js WebGPURenderer、WebGL2 fallback 和 Playground Inspector。
- 项目规范、状态、任务、知识、架构、决策、skills 和 research 导入。

## Non-Goals

- 不实现地图核心功能。
- 不实现 KYE 网络请求、MVT 解码、Tile、LOD、道路、建筑或标签。
- 不确定正式地图公共 API。

## Inputs

- `02_codex_session_b_bootstrap_project.md`。
- 会话 A 的 10 份 research Markdown。

## Constraints

- 保持 SDK/Playground 单向依赖。
- TypeScript、ESM、Three.js WebGPU/WebGL2、TSL。
- Inspector 只在 Playground。
- 源文件以 500 行为上限目标。

## Acceptance Criteria

- 依赖可安装，SDK 可 build，Playground 可 build/启动。
- Playground 通过 workspace import SDK。
- WebGPURenderer 和 WebGL2 fallback 已配置。
- Inspector 已接入且无 HTML 调试侧边栏。
- 指定项目文件和 10 份 research 已建立。
- 没有地图核心功能实现。

## Test Plan

- `pnpm install`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- 启动 Vite 并请求 Playground 首页。
- 使用 `?renderer=webgl2` 验证强制 fallback 路径。
- 对比 research 源文件和导入文件哈希。

## Status

DONE

## Findings

- Three.js 0.185.1 的 `WebGPURenderer` 默认尝试 WebGPU，不可用时自动回退 WebGL2。
- Three.js Inspector 可通过 renderer 的 `inspector` 属性在 Playground 接入。
- `pnpm typecheck`、`pnpm test` 和 `pnpm build` 已通过。
- 浏览器实测默认启动为 WebGPU，`?renderer=webgl2` 启动为 WebGL2，两种路径均显示 Inspector 且无页面启动错误。
- 10 份 research 导入文件与源文件 SHA-256 全部一致。

## Open Issues

- 目标浏览器和 GPU 的人工兼容性验证移交 T002 后续任务。
