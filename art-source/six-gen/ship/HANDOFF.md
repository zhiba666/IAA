# SHIP 美术资源交接

状态：3 件新 PNG 已生成、RGBA 导出并完成局部装配目检；未接正式代码。契约 `six-gen-art-1.0`，基线 `14310d34e882969208bb7583c5e0c8442bfc3aee`。

## 实际交付

- `exports/machine_ship_dual_body.png`：640×451，G03/G04 双空通道。
- `exports/machine_ship_quad_body.png`：640×403，G05/G06 四空通道；六代仍为四道。
- `exports/machine_ship_lane_cover.png`：192×106，独立空通道平盖。
- `sources/` 保留 3 张 1536×1024 原图；无失败图。
- `assembly.json` 保留 G01/G02 单道原坐标，并提供 dual/quad 两个新独立 rig。
- `packaging-reuse.json` 与 `packaging-reuse-preview.png` 复现双杯托空/满、四杯箱空/满/合盖五态。

## 复用和取消

原 `machine_ship_head`、`machine_ship_front` 等比多实例；取消 dual/quad 两张新 front PNG。宽压头是条件项，现有压头可覆盖各通道中央封合点，没有证明需新增，故取消候选。完整双杯/四杯装配继续引用 `product_double_tray`、`product_box_open/front/lid`、既有空杯和填充层。未新画、复制或烘焙杯与产品。

## 已执行检查

三个源图均 PNG colorType 6、有实际透明 alpha；原图 alphaMax=254。`alpha-three-backgrounds.png` 白/深/棋盘三底目检无烘焙底纹、文字、产品、工作头或轮廓裁断。两个机壳导出外边缘 alphaMax=0；盖板因缩小滤镜造成边缘少量 alpha，导出配方增加 2px 透明边距并保留完整主体。

`ship_dual-rig-preview.png`、`ship_quad-rig-preview.png` 检查全头与一头+余道盖板。包装五态图由既有 PNG 独立分层重建；不从整机截图抠产品。slot.packagingRect 使用完整 fourCupBox 160×194 画布比例，预览按 job.amount 选择 1/2/4 份装配并底对齐。SHIP blocked 不可达，记录 N/A；不造虚假出货堵塞。

所有提示词、结果 ID、参考 SHA、原图/导出 SHA、裁切等比变换、机壳接点/槽位在相邻 JSON 文件中。未用 CLI/API、未编造 model/seed。

## 状态和后续

生成：GENERATED；导出：EXPORTED；局部装配：ASSEMBLED_ART_ONLY。全屏两视口和完整状态验收：NOT_RUN（A7）；运行构建、真机：NOT_RUN，不属本轮。下一依赖是 A0/A7 合并验收。禁止路径写入：无；仅本包和同负责人 POP 包。

复现导出：`powershell.exe -NoProfile -ExecutionPolicy Bypass -File art-source/six-gen/pop/export-assets.ps1 -Package art-source/six-gen/ship`。装配和预览均为本包美术交付数据。
