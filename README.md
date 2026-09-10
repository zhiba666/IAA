# 小小爆米花厂 · 2.0.0

原生 Canvas + JavaScript 轻经营流水线游戏，同一正式入口构建浏览器与抖音小游戏包。当前生产循环为：观察瓶颈 → 比较改造影响 → 改善出货 → 赚钱扩建。

## 接续开发入口

- **本任务范围**：[当前开发重心](docs/DEVELOPMENT_FOCUS.md)。本轮将现有首代新美术接入正式游戏入口，并进行整屏画面验收；不重写生产核心、不新增玩法、不批量制作六代美术。
- **当前实现**：以 `src/`、`tests/`、`tools/build.mjs` 和实际执行结果为准；本文件概述生产与平台边界。
- **已选美术基准**：[工厂与 UI 资源](output/imagegen/popcorn-ui-20260909/)、[美术路线及清理记录](docs/ART_DIRECTION_AND_CLEANUP_2026-09-09.md)。旧截图仅作历史运行证据。
- **本次验收证据**：[首代画面验收记录](docs/GEN1_VISUAL_ACCEPTANCE_2026-09-09.md)汇总当前构建、测试、Chrome 实际运行截图与短录屏、加载检查和美术缺口；[运行资源报告](output/gen1-art-runtime/resource-report.md)记录资源体积及双端复制结果。
- **制作方案**：[美术资源计划](docs/ART_ASSET_ADDITION_PLAN_2026-09-09.md)。计划、整图及示例金额不等于已实现功能或经济配置。`art-source/`、`assets/art/` 与旧批次文档保留原制作状态，本次正式接入结果不改写历史 `static-only` 边界。
- **历史资料**：[清理任务开发重心原文快照](docs/history/DEVELOPMENT_FOCUS_CLEANUP_2026-09-09.md)保留上一任务的完整范围。旧路径只描述当时状态，本轮不恢复已删除的 `archive/` 内容。

本次只验收首代新视觉。第 2～6 代继续使用已有显示路径，六代成长仍可进行，不表示六代已全部换肤。画面是否通过以本次验收记录为准，不以测试数量或资源加载成功替代视觉判断。

## 运行与检查

需要 Node.js 18 或更新版本，无 npm 运行依赖。

```powershell
npm run build
npm start
npm test
npm run preflight
```

[浏览器正式入口](http://127.0.0.1:4173)仅监听本机。`npm test` 先构建当前源码；`preflight:strict` 可作更严格静态检查，不能替代真机或账号权限验证。`build:dev` 仍禁用连点和模拟广告。

`tools/build.mjs` 生成 `web/game.bundle.js` 与 `build/douyin/`，并调用 `tools/art-build.mjs` 从现有装配源数据生成运行清单、复制当前引用的 41 个 PNG。两端资源按尺寸与逐文件 SHA-256 核对；整屏参考图、源图和未引用资源不随包发布。不要手改生成包或 `src/art-manifest.js`。本地 `config.local.json` 不被构建改写，格式见 [配置示例](config.local.example.json)。

## 首代正式视觉接入

正式入口通过 `src/first-generation-scene.js` 绘制新美术三工位、两仓和输送路径；`src/interface.js` 绘制主 HUD、工位改造和购买折叠条。`src/art-assets.js` 统一浏览器与抖音图片加载；`src/art-layout.js` 让原图、装配、裁切、端口、工作头与命中区共用坐标变换。UI 使用可伸缩底板，所有文案、数值与状态标记运行时绘制。

生产表现读取真实批次、库存与已发生事件；缺料停止加工，堵塞保留完成品，升级不改变旧批次 `amount`，出货动画不产生库存或金币。此次接入未修改 `src/core.js` 或 `src/factory-rules.js`。

画面验收覆盖 390×844、320×524、安全区、展开/折叠、首次装杯升级、缺料和满仓。极短可用空间保留两行设备/整线比较及 44×44 操作区，辅助说明通过“详情”查看。验收工具使用隔离的本地环境运行同一正式入口与游戏包，已有用户存档保留。

## 当前生产规则

- 核心为 `pop → cup → ship` 三工位，两处有限仓位；统一以整数“份”计量。缺料等待，满仓时保留完成批次并阻塞上游。
- 初始能力为爆锅 4、装杯 2、出货 6 份/秒；两仓各 12 份。首次装杯改造为 30 金币，装杯能力升到 6，整线稳定出货约从 2 升到 4 份/秒。
- 唯一货币是金币，1 份售出 = 1 金币，只有真实出货结算。投产 = 售出 + 两仓库存 + 三工位在制品；余额 = 出货收入 − 改造与扩建支出。
- 设备能力、预测稳定出货、最近 10 秒实际出货分别展示；预测由隔离副本计算，不能替代实测、改变库存或发钱。
- 120 Hz 固定时间量子推进批次与并行通道。升级/扩建保留在制品，已有批次完成后使用新规格。六代成长、价格、库存与门槛由 [factory-rules.js](src/factory-rules.js)统一定义。
- 进入后自动运转，无点击产量、火候、烧焦惩罚。旧合同、分账、能量奖励、设备图鉴、品牌、广告和离线奖励已退役，不能因读到旧研究或新面板示例而恢复。

## 交互、存档与平台边界

点击工位查看改造；报价校验绑定工位、等级、价格与名称。购买后须明确查看下一档，不能因重复点击或旧报价连续购买。保留金币不足、需扩建、满级、选中与库存反馈，主要触控区域至少 44×44 逻辑像素并避开宿主安全区。

键盘 `1/2/3` 切换工位，`Enter` 只提交当前确认报价，`M` 扩建、`S` 设置、`Escape` 关闭。生产反馈只读取真实状态与事件，不重复结算。

存档版本为 2，键为 `little_popcorn_factory_pipeline_v2`。保留 v2 进度，不读取、迁移、改写或删除旧 `little_popcorn_factory_v1`。后台暂停，回来继续，不按离开时长补产发钱。设置重开只影响 v2，保存失败保留当前工厂。

保留触摸、安全区、生命周期、本机存储和音频降级；浏览器用 WebAudio，抖音保留机器、升级、点击和错误 4 个包内 WAV，出货反馈复用点击文件。侧边栏探测、跳转和旧音效已按批准退役。广告接口返回不可用，不创建广告实例。真机验收、软著办理和发布继续按暂停安排处理。

## 文件职责

| 路径 | 职责 |
| --- | --- |
| `src/factory-rules.js`、`src/core.js` | 数值配置、真实生产、成长、守恒与存档 |
| `src/production-insights.js` | 只读预测、瓶颈观察与改造说明 |
| `src/first-generation-scene.js` | 首代新美术分层装配、真实状态表现与生产路径 |
| `src/production-scene.js`、`src/interface.js`、`src/renderer.js` | 高代已有显示路径、界面与命中映射 |
| `src/art-assets.js`、`src/art-layout.js`、`src/art-manifest.js` | 双端图片加载、统一变换与生成的运行资源清单 |
| `art-source/`、`assets/art/` | 已有美术装配源数据与导出素材，保留各批次原始制作边界 |
| `src/main.js`、`src/platform.js`、`src/audio.js` | 正式入口、输入/报价、生命周期、平台与声音 |
| `tools/build.mjs`、`tools/art-build.mjs`、`tools/bundle.mjs`、`tools/serve.mjs`、`tools/preflight.mjs` | 构建、资源清单与双端复制、打包、本地服务与预检 |
| `tools/serve-acceptance.mjs`、`tools/acceptance-runtime.js`、`tools/visual-acceptance.mjs` | 隔离验收环境、正式入口运行截图/录屏支持与真实状态样例 |
| `tests/` | 当前源码的技术回归 |

旧界面截图、旧测试数量和旧包体记录不属于本次完成状态。当前构建、测试、媒体证据与未覆盖范围统一见 [首代画面验收记录](docs/GEN1_VISUAL_ACCEPTANCE_2026-09-09.md)。
