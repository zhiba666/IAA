# 来源索引与证据边界

仓库基线：`14310d34e882969208bb7583c5e0c8442bfc3aee`；访问日期：2026-09-10。完整固定提交 URL 见 `sources.json`。

- **[R1]** `assets/art/manifest.json`
- **[R2]** `docs/ART_ASSET_BATCH_1_2026-09-09.md`
- **[R3]** `art-source/batch-1/README.md`
- **[R4]** `tools/art-build.mjs`；`src/art-manifest.js`
- **[R5]** `art-source/batch-1/machinery/assembly.json`；`art-source/batch-1/core/assembly.json`
- **[R6]** `src/first-generation-scene.js`；`src/production-scene.js`
- **[R7]** `src/factory-rules.js`；`docs/AUTOMATION_V15.md`
- **[R8]** `art-source/batch-0/STYLE_SPEC.md`；`docs/ART_DIRECTION_AND_CLEANUP_2026-09-09.md`
- **[R9]** `output/gen1-art-runtime/resource-report.json`
- **[R10]** `src/art-assets.js`

[O1] OpenAI 官方 Codex Subagents 文档；[O2] OpenAI 官方 Codex Worktrees 文档。只据此说明委派与工作区隔离，不预设特定用户环境已经具备生图权限、额度或全部工具。

历史文档的状态、测试数字和数值示例不等于最新事实。规则以当前源码和实际执行结果为准；本轮未解码目检全部图片、未执行游戏构建、未做真机验证。新增资源预算、分组、数量和验收阈值均为本计划建议，不是当前仓库既有能力。
