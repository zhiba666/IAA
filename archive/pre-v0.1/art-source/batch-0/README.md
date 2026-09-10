# 批次 0 美术源文件

这是独立美术制作目录，不是游戏接入模块。交付与检查状态见 [批次记录](../../docs/ART_ASSET_BATCH_0_2026-09-09.md)。

从项目根目录可重建：

```powershell
powershell -NoProfile -File art-source/batch-0/export.ps1
node art-source/batch-0/write-manifest.cjs
node art-source/batch-0/build-assembly.cjs
powershell -NoProfile -File art-source/batch-0/contact-sheet.ps1
node art-source/batch-0/preview-server.cjs
```

`export.ps1` 使用 Windows System.Drawing 完成确定性切图；不调用图像生成服务。`build-assembly.cjs` 生成自包含分层 SVG；`assembly-preview.png` 是其静态渲染预览。修改装配位置只需编辑 `assembly.json` 后重建 SVG。批量改名或改变导出尺寸后应同步检查清单与装配比例。

源图来自内置 image_gen，提示词与原始文件标识见 `prompts.md` 和 `provenance.json`。`export-recipe.json` 记录每个主体的选取种子和最大导出边长；`export-metrics.json` 记录实际裁切框、尺寸和体积。正式 PNG 位于 `../../assets/art/`。UI 文字、数值及示意标签只存在于预览层。
