# v1.1 地板延展素材

- 正式导出：`exports/factory_floor_extension.png`，512 × 512，不透明 PNG。
- 原图：`sources/factory_floor_extension-original.png`，1254 × 1254；内置 image_gen 生成，未用 CLI/API fallback。
- 最终生成提示词见 `prompt.txt`。导出参数、来源、SHA-256、透明度与体积检查见 `export.json`。可用 `export.cjs` 重建导出（其中 sharp 路径对应本机已安装依赖）。

设计沿用现有 `factory_room.png` 的奶油米色与柔和材质，去掉墙面、踢脚线、砖缝与方向性高光，给设备留出视觉层级。

使用为铺底 cover 背景，可按屏幕覆盖缩放，再叠加墙角层与设备。未保证严格无缝，不能标记为 seamless；不要以明显重复平铺方式使用。旧房间图的对角砖缝和本底纹不连续，因此不能硬拼接成连续瓷砖地面。

导出只做等比缩小与有监督 PNG 调色板压缩，无人工重绘或背景替换。4 色无抖动导出已目检，低对比云纹在手机尺寸不抢主体；原始高精度来源保留，便于后续更高预算使用。
