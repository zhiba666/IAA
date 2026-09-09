# 美术资源第二份交付包 · 首代产线补全

日期：2026-09-09。用户本轮确认“第二批”指接续批次 0，补齐首代产线，对应新增计划的 **批次 1**，并非编号 2 的六代与运输。沿用要求：只制作美术资源，暂不接入游戏。

## 交付范围

新增 **41 张 PNG**，其中 40 张独立透明 RGBA、1 张不透明厂房背景；与批次 0 合计 **60 张**。

| 计划项 | 本批新增 PNG | 交付与复用 |
| --- | ---: | --- |
| A01 厂房 | 3 | 无设备墙地底图、独立窗、独立门口 |
| A02 输送 | 6 | 转接、入料、出料各含带面/底架与前挡；复用原两向直段 |
| A03 三工位 | 6 | 爆锅、出货机各含机体、可动头、前遮挡；复用原装杯机 |
| A04 包装 | 4 | 双杯托、箱后壳、近端两面前墙、箱盖；空杯、填充、散粒复用批次 0 |
| A05 两仓 | 2 | 待发成杯仓后壳与前栏；待装仓复用批次 0 |
| U01 底板 | 2 | 无字卡片与紧凑条，补齐 8 类底板；九宫格边界 32 px |
| U02 图标 | 16 | 金币、出货速度、三工位、设置、声音、振动、关闭、箭头、升级、扩建、勾选、锁定、警示、等待 |
| F01 贴片 | 2 | 蒸汽与金黄星点 |
| 合计 | **41** | PNG 均不含中文、价格、等级或奖励数字 |

小堆与杯内填充共用 `product_cup_fill`，清单显式记录 `product_pile_small` 别名；不为同一外观额外复制 PNG。双杯、四杯开箱与封箱均用独立部件装配。待发仓近侧前栏左右复用一张，右侧在装配坐标中镜像。

另交付 **7 类界面装配稿、24 种 UI 状态、6 组动效规格**，以及机器 12 组合、包装 5 状态、两仓 8 状态。加工、等待与堵塞如何绑定真实批次写在规范中；没有通过静态预览虚构游戏接入。

## 审阅入口

- [41 件新增资源总览](../art-source/batch-1/contact-sheet.png)
- [三工位两仓与库存状态](../art-source/batch-1/scene-preview.png)：390×600 与 320×492 的场景构图，不冒充整屏游戏截图。
- [机械分层与三种出货包装](../art-source/batch-1/machinery/assembly-preview.png)
- [双杯、四杯与封箱装配](../art-source/batch-1/core/assembly-preview.png)
- [16 图标在 24/32 px 的检查](../art-source/batch-1/icons/contact-sheet.png)
- [独立总预览页](../art-source/batch-1/preview.html) 与 [七类界面页](../art-source/batch-1/ui-states/index.html)：后者同时展示 390×844、320×524，可切换状态、8/24 px 安全区和背景。

在项目根目录执行 `node art-source/batch-1/preview-server.cjs`，用 Chrome 打开 `http://127.0.0.1:4175/art-source/batch-1/preview.html`。服务只开放美术目录，不启动游戏、不读取或写入存档。

## 数据、源文件与制作方式

- [统一资源清单](../assets/art/manifest.json)、[本批清单](../art-source/batch-1/manifest.json)、[尺寸/锚点表](../art-source/batch-1/asset-table.csv)。每件记录路径、尺寸、建议显示尺寸、坐标空间、锚点、层级、输入/输出、插槽、裁切、点击区与九宫格。
- [装配索引](../art-source/batch-1/assembly.json)、[场景布局](../art-source/batch-1/scene-layout.json)、[机械装配](../art-source/batch-1/machinery/assembly.json)、[产品装配](../art-source/batch-1/core/assembly.json)。原始图片像素坐标与装配画布坐标已分别说明。
- 可编辑源为独立 PNG 层、JSON 坐标与内嵌 PNG 的 SVG；不声称拥有 3D 工程或可逐顶点编辑的矢量机器。
- [核心提示词](../art-source/batch-1/core/prompts.json)、[核心来源](../art-source/batch-1/core/provenance.json)、[机械来源](../art-source/batch-1/machinery/provenance.json)、[图标来源](../art-source/batch-1/icons/provenance.json)。完整生成源、提示词与导出配方均按组保留。
- [六组动效数据](../art-source/batch-1/ui-states/motion-spec.json) 与 [状态覆盖](../art-source/batch-1/ui-states/state-coverage.md)。自动出货只响应真实 `ship`，不重复发币；混合工作头独立读进度；升级旧批次保留 `job.amount`。

采用内置 **image_gen**，未使用 CLI/API。样式依据四张已选新版图及批次 0 规范，不使用旧版截图或旧机器造型。后续只做机械切图、原 alpha 保留、等比降采样和可编辑分层装配。透明提示词不作为验收证据：有一次转接编辑结果烘焙棋盘格，已淘汰；待发仓视角和转接前栏也重生成过，最终选用记录见配方。完整生成源始终保留。

## 静态验证与边界

- 60 张 PNG 的存在性、IHDR 尺寸、唯一 ID、源文件与裁切范围已核对；新增 41 张全部符合本批 alpha/硬边界检查。其中背景为不透明例外。
- [总预览页检查](../art-source/batch-1/qa/gallery-check.json)：Chrome 实测 41/41 新资源加载且尺寸一致，3 张装配预览也全部加载。白底和深底截图保存于同一 `qa/` 目录；交付文档 27 个本地链接检查无缺失。
- [Chrome 记录](../art-source/batch-1/qa/ui-layout-checks.json)：24 状态 × 两视口无溢出、缺图或小于 44×44 的按钮。另检查 24 px 安全区的扩建异常状态，紧凑场景仍保留 192.5 px 高。修复了九宫格 `border` 简写覆盖图片来源的问题，修后底板已显示。
- [静态规则检查](../art-source/batch-1/ui-states/static-qa.json)：7 稿、24 态、6 动效与 34 个 PNG 引用通过。首次装杯 30 金币、能力 2→6；第 1→2 代 180 金币、100 销量、均速 3、仓位 12→24，均核对当前规则。
- 新机器、包装、输送、两仓在分层预览中检查了空/有料、杯底遮挡、箱盖与工作头；整条路径 9 个记录接点坐标吻合。代表性库存用有限精灵，数量另绘。
- 图标检查了 24/32 px 及浅/深底；独立资源页提供白、深、棋盘格底。复查批次 0 发现 `product_kernel_a` 有 6 个 alpha≥128 的边界像素，记录在 [alpha 审计](../art-source/batch-1/alpha-audit.json)，本轮未覆盖该旧资源。

**图片体积仍待收尾优化。** 全部 60 PNG 实测 **4,210,125 B（4.015 MiB）**，解码估算 **15.91 MiB**；新增包约 **2.49 MiB**。低细节背景降采样为 512×768，机器主体最长边 512、工作头 256；更大生成源仍可重新导出。当前未满足首代 P0 ≤2 MiB 目标，亦略高于完整美术 ≤4 MiB 目标；解码低于 32 MiB。后续 G01/T01/B01 还会增加资源，需结合实际接入选择显示尺寸、压缩与图集。预览、源图不计入运行资源预算。

本轮完成的是 **批次 1 美术制作与静态技术校对**。清单仍保持 `integrated=false`、`stateBound=false`、`accepted=false`；正式游戏状态、双端加载、真实性能、游戏大小屏点击及最终验收未执行。没有修改游戏代码，也没有运行会重建游戏包的 `npm test/build/preflight`；本轮检查针对独立资源与预览。工作区其他并行改动不归属于本交付。

下一资源阶段为计划编号 2 的 G01 六代成长与 T01 运输；B01、统一压缩/图集和透明边缘收尾仍属批次 3。
