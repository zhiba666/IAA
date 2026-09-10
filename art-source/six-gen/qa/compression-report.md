# 旧素材 PNG 候选压缩实验

只写 qa/compression-experiment；未改原图与正式清单。原 60 张共 4210125 B。

| 方案 | 全部60 PNG B | 41运行 PNG B | 全部RGBA B | 最大合成RGB RMSE |
|---|---:|---:|---:|---:|
| full256 | 1211113 | 1068616 | 16678144 | 2.024 |
| compact256 | 767410 | 657958 | 9788672 | 2.024 |

Full256 保持原尺寸；Compact256 将机器/环境/UI底板等比缩小到约75%，产品及图标不变。每图输出256色带alpha PNG，透明通道不以白色抠图。原始 kernel_a 边界问题会被实验沿袭，正式候选仍需修复。

[对照图](compression-experiment/comparison-contact-sheet.png)，逐件 SHA、尺寸、Alpha 最大误差和暗/亮底合成 RMSE 见 compression-report.json。误差指标只用于筛选，不代替视觉验收；六代首包/转代峰值仍需真实依赖并集。

目检：12类对照图与3件compact原尺寸PNG复核，杯体白条未误删，机器/UI轮廓与阴影保留，未见新增棋盘格或白边。优先采用compact256作为common候选，原kernel_a仍单独修复；不宣称60件全部逐图视觉验收。
