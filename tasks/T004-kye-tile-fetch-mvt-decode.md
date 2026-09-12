# T004 Implement KYE Tile Fetch and MVT Decode

## Goal

实现可独立测试的 MVT Source、KYE Tile 请求与 MVT v2 解码层，正确处理 URL 节点、取消、HTTP 状态、浏览器 gzip 和真实 KYE fixture。

## Scope

- `VectorTileSourceOptions` 校验和 XYZ URL 模板展开。
- canonical key 稳定 hash 选节点、超时/取消、网络与 HTTP 错误分类。
- 204 empty、200 ArrayBuffer、4xx/5xx 和最多三次网络/5xx 轮换重试。
- MVT v2 解码为与 Three.js 无关的 layer/feature/properties/geometry 结构。
- 保持字段原始 string/number/boolean/null 语义。
- 真实 KYE 固定 fixture、来源元数据和 SHA-256 记录。
- 评估并安装批准的 `pbf`、`@mapbox/vector-tile` 依赖。

## Non-Goals

- 不实现 Worker Pool、Polygon 三角化、Line mesh、Camera、Tile Cache 或 GPU 上传。
- 不把 404 当 empty，不推断未验证字段 schema。
- 不实现完整 Style v8、Geobuf、Raster、Glyph 或 Sprite。

## Inputs

- T003 输出。
- `docs/architecture.md` 的请求、Source、Decoder 和错误模型。
- `docs/decisions.md` D015、D019、D021。
- `docs/research/kye-data.md`、`kye-mvt-data-dictionary.md`、`reusable-assets.md`。

## Constraints

- 浏览器 Fetch 已按 Content-Encoding 解压，生产主链不得重复 gunzip。
- fixture 自动测试不依赖实时外部网络；真实网络只作明确的人工/集成验证。
- 新依赖必须记录精确版本、许可证、替代方案、类型和 bundle 影响。
- Fetch/Decoder 不创建 Three.js 对象。

## Acceptance Criteria

- 同一 canonical key URL 选择稳定，重试按节点轮换并可被 AbortSignal 取消。
- 204 返回 typed empty 结果，不进入 decoder。
- 真实 KYE fixture 解码出 version 2、extent 4096 和预期 source-layer/feature 摘要。
- decode/protocol/HTTP/network/abort 被明确区分，取消不包装成用户错误。
- SDK build 不内嵌第二份 Three.js，新增依赖可在 ESM 与后续 Worker 环境使用。

## Test Plan

- Mock fetch：200、204、404、500、network error、timeout、abort、节点轮换。
- Fixture decode：Polygon、Line、多个 ring、字段类型和无顶层 feature id。
- 损坏/截断 PBF 和不支持的 version。
- `pnpm --filter @nova/map3d test`、`pnpm check`。
- 人工请求 research 中的 KYE 样本并核对 fixture 来源摘要。

## Status

DONE

## Findings

- 新增公共 `VectorTileSourceOptions`、`LayerPropertyValue` 和 MapError 基础类型；Source/Fetch/Decoder 实现保持内部模块边界且不依赖 Three.js。
- Source 校验覆盖 id、XYZ URL 占位符、min/max zoom 和 Web Mercator bounds；canonical key 使用稳定 FNV-1a 选择起始节点，重试按模板顺序轮换。
- Fetch 默认 15 秒单次超时、最多 3 次尝试、指数退避和 jitter；网络/timeout 与 HTTP 5xx 可重试，HTTP 4xx 不重试，204 返回 typed empty，用户 AbortSignal 原因直接传播且不包装为 MapError。
- MVT Decoder 使用纯 ESM `pbf` 5.1.2 与 `@mapbox/vector-tile` 3.0.0，输出 source-layer、feature index/id、原始属性类型和脱离第三方 Point 原型的 geometry paths/rings；拒绝损坏 PBF、未知 geometry 和非 v2 layer。
- 两个依赖均为 BSD-3-Clause、内置 TypeScript 类型并可由 Vite 作为 Worker 风格独立入口打包；minified decoder 为 15,325 bytes、gzip 4,457 bytes，未包含 Three.js。替代方案为自研 protobuf/MVT parser，协议和维护风险更高。
- 固定 fixture 来源为 KYE 主瓦片 `z15/26978/12416`；2026-09-08 实时响应 gzip 长度 17,909 bytes，解压后 35,594 bytes，SHA-256 `46f4ff67546c8ca229d76b5e31e4758cdf7b31588657dc9c89702aa62482202f`。
- 实时调用本 Task 的 Source/Fetch/Decoder 得到 water 4、landuse 39、poi_label 17、building 233、road 386、waterway 1；与 fixture 元数据一致。
- `pnpm --filter @nova/map3d test` 通过：8 个测试文件、33 个测试全部通过。
- `pnpm check` 通过：SDK/Playground 类型检查、34 个测试、SDK build 和 Playground production build 全部成功。

## Open Issues

无。
