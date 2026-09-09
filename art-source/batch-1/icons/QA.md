# U02 · 16 类统一 UI 图标校对

日期：2026-09-09。仅交付独立美术资源。

- 16 类均由内置 image_gen 独立生成；源图不修改，完整提示词见 prompts.md。
- 96×96 RGBA 画布，主体最长边 88 px，居中保留边距；裁切矩形、尺寸、体积、SHA-256 与 alpha 像素统计见 export-metrics.json。
- 机械导出：以 alpha≥128 的主体边界外扩 3 个源像素裁切，保留原始 alpha，等比双三次缩小并放入透明画布；不重绘、不变色、不填底。
- 已逐件目检 contact-sheet.png 中 96、32、24 px 的显示。三种工位分别依靠灰色爆锅、红白杯与金色纸箱辨认；声音与震动形状区分；关闭、方向、升级、扩展、勾选、锁定、警告、等待均可读。
- 浅色与深色背景复合检查未见棋盘格底、白色矩形底、光晕或裁切。齿轮中心、锁环与机器框架空隙保留透明。
- 16 张运行 PNG 合计 198,614 bytes（约 194 KiB）；RGBA 解码总量 589,824 bytes（576 KiB）。

复现：在仓库根目录执行 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File art-source/batch-1/icons/export.ps1`，然后执行同目录 `contact-sheet.ps1`。导出脚本从 PowerShell 7 启动时会自动使用 Windows PowerShell 5.1。
