# v1.3 首二代工艺美术补充包

制作日期：2026-09-12。本包补充焦糖加工的空载、散料、糖浆与包装中间态，供下一阶段首二代玩法绑定使用。原 [v1.3 静态包](../v1.3/README.md) 的 18 张新增图和 16 项复用资源已经齐全；本次新增 5 张透明 PNG 独立管理，不重复制作静态成品，也不表示订单或焦糖生产已经实现。

## 交付内容

| ID | 用途与缺口 | 导出尺寸 |
| --- | --- | --- |
| `machine_caramel_coater_empty` | 去除滚筒内颗粒与外流糖浆，保留罐内糖浆；支持空载和等待 | 478 × 480 |
| `material_caramel_popcorn` | 独立焦糖散料，供裹糖、出料和装桶叠加；后续可复用于双拼与星模 | 192 × 185 |
| `caramel_syrup_flow` | 可独立显示、停止的糖浆流 | 111 × 192 |
| `product_caramel_tub_empty` | 与现有焦糖成品对应的空包装桶，供装桶中间态使用 | 256 × 214 |
| `material_original_popcorn` | 与新焦糖散料统一样式的原味料堆；属于质量补充，旧 `product_kernel_a/b` 和 `product_cup_fill` 已能表示原味 | 192 × 184 |

前四项填补真实加工中间态，原味料堆用于统一表现。角色继续复用既有立绘、取货袋与成品图；共享货架、手势、金币和订单状态图标仍按原资源合同复用。

## 查看与装配

- [交互预览](index.html)：空载、入料、裹糖、出料、满仓、装桶六种表现状态。
- [装配定义](assembly.json)：机器与包装内容层的坐标、裁剪和挂接信息。
- [五图总览](qa/contact-sheet.png)、[三种背景检查](qa/three-backgrounds.png)、[透明导出](exports/)。
- [资源清单](manifest.json)。
- 完整生成提示词与修订记录：[机器与糖浆](machine/provenance.json)、[两款散料](materials/provenance.json)、[空包装桶](packaging/provenance.json)。

预览中的状态和进度仅用于美术装配检查，不读取真实批次、订单、库存或收益。滚筒仍包含在静态整机内，本包只拆出了加工内容与糖浆效果；尚未完成滚筒、机架和前侧机械部件的完整活动层拆分。满仓等状态也只是表现样例，后续须由真实核心事件驱动。

在仓库根目录运行：

```powershell
npm run art:v13:process
npm run art:v13:process:verify
npm run art:v13:process:preview
```

预览服务仅监听本机，默认提供 [首二代工艺预览](http://127.0.0.1:4174/art-source/v1.3-process/)。服务不运行游戏核心。

## 来源、预算与验证边界

全部源图由内置 `image_gen` 制作或编辑。各分类的 `sources/` 保留选用源图，`prompts/` 和 `provenance.json` 记录提示词、参考图、生成尝试、透明修正和哈希；未使用程序抠图、重绘或改色。导出仅按真实 alpha 包围框裁切、等比 Lanczos3 缩小，并增加四周 4px 透明留边。

源图可能带有零星非透明边缘像素，清单如实记录 `sourceBoundaryNontransparentPixels`；这不等于导出透明边框失败。五张导出的边缘非透明像素均为 0，四周透明边框检查通过。机器长边上限 480px，散料和糖浆流 192px，空桶 256px。

五张导出压缩合计 **493,802 B**，低于 512 KiB 预算；RGBA 尺寸估算合计 **1,505,536 B**，低于 3 MiB 预算。数字只含这五张导出，不含保留源图、QA 合成图、Canvas 或 GPU 副本，也不是设备内存实测。

本包不复制到正式 `assets/`、Web 或抖音资源目录，不加入原 18 张 v1.3 清单或 87 张基础预载清单。`manifest.json` 和 `catalog.js` 由本包构建生成；`--verify` 读取并校验既有产物，不重建导出或清单。

本包的实际加工绑定、完整机械动作和真机验收仍需后续实施。
