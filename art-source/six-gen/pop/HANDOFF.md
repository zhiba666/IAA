# POP 美术资源交接

状态：5 件新 PNG 已生成、RGBA 导出并完成局部装配目检；未接正式代码。契约 `six-gen-art-1.0`，基线 `14310d34e882969208bb7583c5e0c8442bfc3aee`。

## 实际交付

- `exports/machine_pop_pair_body.png`：640×422，G02/G03 双空座。
- `exports/machine_pop_quad_body.png`：640×433，G04/G05 四空座。
- `exports/machine_pop_hex_body.png`：640×436，G06 六空座。
- `exports/machine_pop_double_carrier.png`：192×137，双份空托具。
- `exports/machine_pop_socket_cover.png`：192×180，未安装槽位平盖。
- 原尺寸生成图保留在 `sources/`；2 张失败图保留在 `sources/rejected/`，不计交付数量。
- `assembly.json` 保留 G01 原 640×770 坐标并提供 pair/quad/hex 三个独立 rig；六代共用四套模板。

## 复用和取消

原 `machine_pop_head`、`machine_pop_front`、产品颗粒/填充继续引用既有 PNG；没有复制产品或工作头。取消 pair/quad/hex 三张新 front 候选：既有前挡在每个锅座等比重复即可。前挡按各槽深度排序，后排前挡先于近排工作头，避免穿插。

## 已执行检查

源 PNG IHDR 均为 colorType 6；有实际 alpha=0 像素，alphaMax=254。按 alpha>0 完整范围加边缘裁切并等比缩小，原图未改。`alpha-three-backgrounds.png` 展示白、深色、棋盘三底目检，无烘焙底纹、产品、文字或切断主体。五个导出边缘 alphaMax 均为 0。

`pop_pair-rig-preview.png`、`pop_quad-rig-preview.png`、`pop_hex-rig-preview.png` 分别检查全头与一头+盖板；样板也保留 `pair-head-reuse-preview.png`。所有源/导出 SHA、提示词、实用参考 SHA、裁切和变换在 manifest/provenance/export-recipe/qa-report 中。

quad 前两次因 RGB 棋盘底拒收，按计划停止；A0 依据已成功的单参考简短提示方法批准 `CR_ALPHA_02` 第三次单次受控生成，得到真 RGBA，随后结束该资产重试。未使用 CLI/API，也未编造 model 或 seed。

## 状态和后续

生成：GENERATED；导出：EXPORTED；局部装配：ASSEMBLED_ART_ONLY。全屏两视口、54 状态、运行构建与真机：NOT_RUN（A7 负责全屏静态检查；运行和真机不属本轮）。下一依赖是 A0/A7 合并验收。禁止路径写入：无；本任务仅写 `art-source/six-gen/pop/` 与同一负责人负责的 `ship/`。

复现导出使用 Windows PowerShell：`powershell.exe -NoProfile -ExecutionPolicy Bypass -File art-source/six-gen/pop/export-assets.ps1`。预览脚本只生成本包独立美术证据，不接入游戏。
