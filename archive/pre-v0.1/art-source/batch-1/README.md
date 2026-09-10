# 批次 1 · 首代美术资源

接续批次 0 的第二份交付包；仅资源，不接游戏。详情见 [交付记录](../../docs/ART_ASSET_BATCH_1_2026-09-09.md)。

先看 [总览](contact-sheet.png)、[产线装配](scene-preview.png) 和 [包装](core/assembly-preview.png)。运行 `node art-source/batch-1/preview-server.cjs`，Chrome 打开 `http://127.0.0.1:4175/art-source/batch-1/preview.html`。

三个生成组：`core/`（11 件环境/包装/UI/FX）、`machinery/`（14 件机械/输送/仓体）、`icons/`（16 图标）。各组保留源图、提示词、来源、export 配方与指标。`ui-states/` 保存 7 类界面、24 状态及 6 组动效规范。

复现顺序（项目根目录）：

1. `powershell -NoProfile -File art-source/batch-1/core/export.ps1`
2. `powershell -NoProfile -File art-source/batch-1/machinery/export.ps1`
3. `powershell -NoProfile -File art-source/batch-1/icons/export.ps1`
4. `node art-source/batch-1/build-delivery.cjs`（合并批次 0，不覆盖旧 19 项；复现后技术检查标志回到待复核）
5. `powershell -NoProfile -File art-source/batch-1/check-alpha.ps1`
6. `node art-source/batch-1/ui-states/verify-static.cjs`
7. 运行 `core/build-assembly.cjs`、`machinery/build-assembly.cjs`、`build-scene.cjs`、`build-contact-sheet.cjs` 重建可编辑 SVG；支持的渲染脚本可传入 Sharp 模块绝对路径生成 PNG，机械 PNG 另用 `machinery/build-preview.ps1`。

最终复核后用 `node art-source/batch-1/build-delivery.cjs --verified` 标记静态技术预览已检查，仍不会标记游戏接入或最终验收。不要直接运行批次 0 的旧 `write-manifest.cjs`：它只写样板清单；如误跑，可执行本批 `build-delivery.cjs` 重新汇总。

`validation.json` 记录文件尺寸、SHA256 与体积；`alpha-audit.json` 将本批检查与批次 0 的既存边界问题分开。当前总导出约 4.015 MiB，首代 2 MiB 与完整 4 MiB 的压缩目标仍待收尾优化。
