# 六代美术基线审计

只做美术基线审计，未修改 assets/art、src、tools，未执行游戏构建或接入。记录于 2026-09-10T06:34:26.162Z。

## 基线与实体

- 当前 HEAD：`14310d34e882969208bb7583c5e0c8442bfc3aee`，与计划基线完全一致。
- assets/art、src、tools 相对计划提交无差异。工作区其他既有未跟踪文件见 JSON 快照。
- 实体 PNG 60 个、清单 60 项、计划复用 60 项；运行选择 41 个。文件、尺寸、字节、解码估算与清单一致；运行时 41 个 SHA 一致。
- 全部 60 张 PNG 已逐图实际解码，JSON 逐件记录 SHA、透明/半透明/不透明像素、边界和 alpha 可见范围。四张选定参考及九张代表性现有图已工具目检；未冒充全部逐图视觉验收。
- 候选计划含 39 个必需新增和 1 个条件新增，尚无同名正式 PNG。

## 预算实测

| 集合 | PNG 文件字节 | PNG MiB | RGBA 基础字节 | RGBA MiB |
|---|---:|---:|---:|---:|
| 60 张全部 | 4210125 | 4.0151 | 16678144 | 15.9055 |
| 41 张运行选择 | 3775008 | 3.6001 | 14726912 | 14.0447 |

完整美术 4 MiB 目标已超出 15821 B；当前运行集合较首代/首包 2 MiB 目标超出 1677856 B。RGBA 基础解码估算在 32 MiB 目标内，但不等同 GPU 或进程总内存。新增六代素材必须在候选目录优化并重新测量 common + generation 与转代并集；当前结果不能证明六代预算通过。

## 复用与必须修复

1. `product_kernel_a` 边缘缺少安全透明间隔，重新解码确认 6 个外边界像素 alpha ≥ 128。必须从原源图恢复完整裁切/用图像工具修复后导出到候选目录，保留原件；仅补空白不能证明恢复了被切断轮廓。
2. 空杯、填充、三类工作头与无字 UI 底板目检可作为同风格复用基础。kernel_b 轮廓正常；kernel_a 右侧轮廓触边。装配预览证明杯/产品/头/挡板分层结构可延用，但高代插槽比例仍需新静态装配验证。
3. 输送、两仓、包装旧件经实体和 alpha 技术核查可进入复用候选。其局部接料位置、遮挡、小屏辨識度由各新装配验证，不能用技术通过替代视觉通过。
4. 原首代机体/front 保留，新多头机壳不得对旧整机非等比横拉。
5. factory_room 允许不透明且接触画布边界；其他透明精灵的强 alpha 边界接触按缺陷检查。
6. 源图和概念 UI 中示例文字/金额/数值不成为资源文字或新玩法。

## 可用参考

- [popcorn-factory-simplified.png](../../../output/imagegen/popcorn-ui-20260909/popcorn-factory-simplified.png) — 1024×1536，SHA-256 `28d325cdb53841889554fc6a2301040e443fa2c7bcde30f88c19eeed2abcc672`
- [ui-components.png](../../../output/imagegen/popcorn-ui-20260909/ui-components.png) — 1536×1024，SHA-256 `ece92e9eb1ec2f45e28fee4bda1683810be2781bdbb55ad2a8f63916e9c9726a`
- [ui-upgrade-and-production.png](../../../output/imagegen/popcorn-ui-20260909/ui-upgrade-and-production.png) — 1536×1024，SHA-256 `5144fe50adeb3a315fd20828b959936dbc47f7eb86c8295ae7eb8de1f4c246ca`
- [ui-tasks-and-shipping.png](../../../output/imagegen/popcorn-ui-20260909/ui-tasks-and-shipping.png) — 1536×1024，SHA-256 `c101ec2b7169dffc55fd442c0e3decf7f3404fd1b129e5f15fb428df014f4541`

同一目检参考中，机器是简化圆角体块、青绿/灰钢、大色块和左上光；红白杯和黄色爆米花为视觉重点。UI 使用奶油底和青绿边框，主动作黄色。带文字整板仅用于外观方向。真实绝对路径及杯、头、UI、装配参考在 JSON 的 references/referenceSupport。

## 工具

- Node：`C:\Program Files\nodejs\node.exe`
- sharp：`C:\Users\chenweilun\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\sharp\dist\index.cjs`
- pngjs：`C:\Users\chenweilun\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node_modules\pngjs\lib\png.js`
- Python：`C:/Users/chenweilun/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe`；Pillow 已存在，只检查可用性。
- 未安装依赖；canvas 不可用。本审计用 sharp 读取图片而未编辑图片。

## 逐件结果

边界列是外边界 alpha ≥ 128 像素数；factory_room 不透明背景为例外。

| ID | 尺寸 | PNG B | 边界 ≥128 | 运行选择 | 处理 |
|---|---:|---:|---:|---|---|
| fx_sparkle | 104×128 | 11678 | 0 | 是 | 技术复用候选 |
| fx_steam | 63×128 | 12213 | 0 | 否 | 技术复用候选 |
| machine_cup_body | 448×640 | 339298 | 0 | 是 | 技术复用候选 |
| machine_cup_front | 384×304 | 90026 | 0 | 是 | 技术复用候选 |
| machine_cup_head | 150×256 | 59746 | 0 | 是 | 技术复用候选 |
| machine_pop_body | 512×489 | 326872 | 0 | 是 | 技术复用候选 |
| machine_pop_front | 384×205 | 95647 | 0 | 是 | 技术复用候选 |
| machine_pop_head | 256×248 | 92668 | 0 | 是 | 技术复用候选 |
| machine_ship_body | 499×512 | 297140 | 0 | 是 | 技术复用候选 |
| machine_ship_front | 384×222 | 64177 | 0 | 是 | 技术复用候选 |
| machine_ship_head | 159×256 | 58499 | 0 | 是 | 技术复用候选 |
| product_box_front | 128×78 | 11375 | 0 | 否 | 技术复用候选 |
| product_box_lid | 128×91 | 12401 | 0 | 否 | 技术复用候选 |
| product_box_open | 127×128 | 24580 | 0 | 否 | 技术复用候选 |
| product_cup_empty | 104×128 | 26014 | 0 | 是 | 技术复用候选 |
| product_cup_fill | 128×94 | 27366 | 0 | 是 | 技术复用候选 |
| product_double_tray | 128×80 | 16026 | 0 | 否 | 技术复用候选 |
| product_kernel_a | 64×61 | 8907 | 6 | 是 | 必须修复候选 |
| product_kernel_b | 64×62 | 9324 | 0 | 是 | 技术复用候选 |
| buffer_bulk_back | 512×366 | 215944 | 0 | 是 | 技术复用候选 |
| buffer_bulk_front | 384×243 | 64833 | 0 | 是 | 技术复用候选 |
| buffer_cups_back | 512×349 | 158708 | 0 | 是 | 技术复用候选 |
| buffer_cups_front | 384×256 | 46707 | 0 | 是 | 技术复用候选 |
| conveyor_down_left | 512×358 | 172176 | 0 | 是 | 技术复用候选 |
| conveyor_down_right | 512×360 | 180083 | 0 | 是 | 技术复用候选 |
| conveyor_front_left | 384×245 | 44828 | 0 | 是 | 技术复用候选 |
| conveyor_front_right | 384×248 | 48177 | 0 | 是 | 技术复用候选 |
| conveyor_infeed_back | 512×383 | 155686 | 0 | 否 | 技术复用候选 |
| conveyor_infeed_front | 384×218 | 34051 | 0 | 否 | 技术复用候选 |
| conveyor_outfeed_back | 512×332 | 154442 | 0 | 是 | 技术复用候选 |
| conveyor_outfeed_front | 384×211 | 33067 | 0 | 是 | 技术复用候选 |
| conveyor_transfer_back | 512×227 | 144111 | 0 | 是 | 技术复用候选 |
| conveyor_transfer_front | 384×121 | 25806 | 0 | 是 | 技术复用候选 |
| factory_door | 197×256 | 49263 | 0 | 否 | 技术复用候选 |
| factory_room | 512×768 | 440532 | 2556 | 是 | 技术复用候选 |
| factory_window | 256×233 | 74041 | 0 | 是 | 技术复用候选 |
| ui_button_disabled | 384×138 | 49591 | 0 | 是 | 技术复用候选 |
| ui_button_primary | 384×138 | 58620 | 0 | 是 | 技术复用候选 |
| ui_button_secondary | 384×138 | 52532 | 0 | 是 | 技术复用候选 |
| ui_card | 384×115 | 39840 | 0 | 是 | 技术复用候选 |
| ui_compact_bar | 384×78 | 31056 | 0 | 是 | 技术复用候选 |
| ui_hud_coin | 384×138 | 53310 | 0 | 是 | 技术复用候选 |
| ui_hud_rate | 384×138 | 46665 | 0 | 是 | 技术复用候选 |
| ui_icon_arrow | 96×96 | 7658 | 0 | 否 | 技术复用候选 |
| ui_icon_check | 96×96 | 8034 | 0 | 否 | 技术复用候选 |
| ui_icon_close | 96×96 | 13325 | 0 | 否 | 技术复用候选 |
| ui_icon_coin | 96×96 | 16286 | 0 | 是 | 技术复用候选 |
| ui_icon_cup | 96×96 | 15017 | 0 | 是 | 技术复用候选 |
| ui_icon_expand | 96×96 | 9473 | 0 | 否 | 技术复用候选 |
| ui_icon_lock | 96×96 | 12967 | 0 | 否 | 技术复用候选 |
| ui_icon_pop | 96×96 | 18353 | 0 | 是 | 技术复用候选 |
| ui_icon_settings | 96×96 | 12481 | 0 | 是 | 技术复用候选 |
| ui_icon_ship | 96×96 | 16955 | 0 | 是 | 技术复用候选 |
| ui_icon_ship_speed | 96×96 | 9307 | 0 | 否 | 技术复用候选 |
| ui_icon_sound | 96×96 | 11308 | 0 | 否 | 技术复用候选 |
| ui_icon_upgrade | 96×96 | 12174 | 0 | 否 | 技术复用候选 |
| ui_icon_vibration | 96×96 | 10889 | 0 | 否 | 技术复用候选 |
| ui_icon_wait | 96×96 | 13741 | 0 | 否 | 技术复用候选 |
| ui_icon_warning | 96×96 | 10646 | 0 | 否 | 技术复用候选 |
| ui_panel | 384×138 | 53485 | 0 | 是 | 技术复用候选 |

补充：旧batch-0的19项源manifest未填写bytes/decodedBytes字段，JSON已逐件记录；并非文件内容或尺寸不一致。41项运行manifest的完整元数据、字节和SHA全部匹配实测。
