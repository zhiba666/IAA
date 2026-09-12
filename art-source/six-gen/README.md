# IAA 六代美术资源交付

本目录已用于正式游戏。当前构建读取 [活动装配目录](integration/legacy/README.md)、最终导出和资源清单。

## 先看这里

- 最终 PNG：integration/exports/
- 总清单、来源及装配：integration/manifest.json、provenance.json、assembly.json

## 交付数量

24 张新增独立 PNG：爆锅 5、装杯 4、出货 3、物流 6、UI 3、场景 3。其中货架前缘由新原图精确拆层，未重复生图。
60 张既有资源复用，最终共 84 张唯一 PNG。39 个基础候选中，24 个导出、15 个由合格共享件替代；1 个条件宽压头经复用检查无需新增。候选逐项去向见 integration/candidate-resolution.json。
18 个代际工位配置、12 套代际设备组合；扩建前后保留安装数和批次量差异，空槽使用盖板。

## 体积

最终 PNG 合计 1,846,247 B（1.76 MiB）；RGBA 基础解码估算 26,848,144 B（25.60 MiB）。第一代候选依赖并集 842,131 B，三个内部预算目标均通过。此处不含原图/预览/ZIP体积，不等于GPU或进程内存。

## 原图与制作记录

内置 image_gen 生成；准确提示词、参考 SHA、原图及失败版本在各包 sources/、prompts 与 provenance 中。源图保持原尺寸；导出采用等比裁切/缩小和有监督 PNG 色彩量化。正式旧图不变。kernel_a 候选增加透明边距；kernel_b 与禁用按钮因量化影响边缘而保留原 PNG。

最终以 integration/manifest.json 中 file 与 SHA 为准。各包 exports/ 是制作候选，体积不同但坐标保持一致。integration/common 是共享资源优化步骤，最终发布候选统一在 integration/exports。
