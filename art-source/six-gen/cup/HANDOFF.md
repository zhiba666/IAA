# CUP 美术资源交接

仅制作独立美术资源、装配 JSON 和静态预览；未接入正式代码。

本包完成 4 张真实 RGBA 空机壳导出：`exports/machine_cup_pair_body.png`（601×640）、`machine_cup_triple_body.png`（640×586）、`machine_cup_quad_body.png`（601×640）、`machine_cup_hex_body.png`（640×586）。合计 1,647,872 bytes。四、六仓使用 2×2 / 2×3 阶梯排布，后排安装位可见。

`assembly.json` 提供 1 / 2 / 3 / 4 / 6 头的独立坐标画布、input、output、anchor、hitPolygon、每槽 head / cup / front / cover / clip，四、六仓另含双杯托具完整 `packagingRect`。G02 / G03 共享双仓壳。所有单件和托具均等比放置，产品及工作头没有烘焙进机壳。

新增清单经复用缩减 6 项：四款前挡由已有 `machine_cup_front` 按槽实例组合；双杯托使用 `product_double_tray` 及旧 `doubleTray` 前遮挡裁切；空槽盖直接引用 POP 包 `machine_pop_socket_cover`，放在停用仓地面安装位，同时隐藏该槽工作头和产品。旧空杯、填充和工作头直接引用原路径，不复制改名。复用 SHA 见 `provenance.json`。

实际执行 10 次内置 `image_gen.imagegen`，得到 4 张有效 RGBA 原图和 6 张不合格 RGB 棋盘格原图，全部保存在 `sources/`。失败图不进入导出清单。严格保留实际提示词、源图 SHA 和工具返回文件位置，模型名称、seed、额外图像 ID 未提供，均标为 unavailable。两次失败后曾停止；A0 根据新的真实透明成功证据分别批准 `CR_ALPHA_01` 和 `CR_ALPHA_02` 受控第三次处理，记录在 `prompts.jsonl` 与 `provenance.json`。未切换 CLI/API。

依赖锁：`six-gen-art-1.0`；基线 `14310d34e882969208bb7583c5e0c8442bfc3aee`。`reference-lock.json`、`style-contract.json`、旧装配及所有引用的实际 SHA 已写入 `provenance.json`。

已执行：源 PNG 签名、尺寸、模式、原文件/副本 SHA 一致性；四导出真实 alpha、透明外边界；所有 rig 单件与托具等比校验、画布范围校验；四机壳浅/深/棋盘底目检；独立头/杯/前挡及空槽盖分层目检；四/六槽双杯与旧一份/新两份混合静态装配目检。证据为 `image-audit.json`、`export-audit.json`、`qa-report.json` 及 `previews/`。边缘源数据含隐藏或极低 alpha 的青/蓝 RGB 残留，未全局删色；最终浅深底合成已目检。

状态：生成完成、4 PNG 已 EXPORTED、局部 ASSEMBLED_STATIC_ART；等待 A0/A7 合并场景独立 QA。整屏状态验收由独立 QA 包负责，本包不据局部预览声称真机通过。运行接入、构建、存档/经济回归、设备测试均为 NOT_RUN（不属于用户本轮授权范围）。

重现导出和预览：在仓库根运行本包 `finalize-cup.ps1`；重建来源及几何校验报告运行 `finalize-reports.ps1`。脚本唯一写入范围均为本包。

禁止路径检查：A2 所有写入位于 `art-source/six-gen/cup/`。未覆盖正式 `assets/art`、`src`、构建目录、根级 AGENTS.md、旧批次或其他 agent 文件。
