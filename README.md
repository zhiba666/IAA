# 小小爆米花厂 · 1.0.0

一款竖屏、单指操作的爆米花工厂增量游戏。原生 Canvas + JavaScript 实现，无 npm 运行依赖；同一套玩法代码生成浏览器试玩和抖音小游戏包。

**当前安排（2026-09-08）：暂缓真机验收与软著办理，着重打磨游戏体验。** 优先改善首局引导、成长节奏、操作反馈和界面细节，验证以浏览器、IDE 和适用自动测试为主。暂停事项待用户明确恢复后继续；详见[当前开发重心](docs/DEVELOPMENT_FOCUS.md)。

## 当前玩法

- **产出形态与换代反馈**：散粒 → 满杯 → 双杯组 → 六杯整托 → 封装箱 → 整垛货；换代通过旧机退场、新机落位和首批成品发运呈现成长。普通粒子固定，成品按批次清晰出货，预览与真实收益同步展示。详见[本轮实现与验证](docs/PRODUCTION_FORMS_2026-09-08.md)；本地可运行 `node tools/production-growth-check.mjs` 打开[换代演示](http://127.0.0.1:4173/production-growth-check.html)。
- 点击生产与自动出售、自动生产、免费爆锅、三类永久升级、六阶段机器和批量升级。首次免费爆锅后可在 **92–98 能量点火**，命中后本锅额外 +20%，失误不影响原有免费爆锅；后续开放余热接力与练习。
- 20 个主线订单、4 章 16 项成长任务、分段交付、自选补货或精品委托、循环订单，以及竣工后可购买的三件永久陈列。
- 双缸机后开放常规／赶单／高价生产档位，流水线后开放两条各三级工艺；当前目标与推荐操作联动，厂房和包装随成长变化。
- **免费风味研发与八组课题手册**：完成第 10 单后开放产量、售价两条各 12 级研发，正常生产完成试制，验收后永久提升，兼容旧存档与离线进度。详见[研发规则](docs/CONTENT_EXPANSION_2026-09-08.md)、[调研依据](docs/INCREMENTAL_CONTENT_RESEARCH_2026-09-08.md)和[成长节奏模拟](docs/CONTENT_GROWTH_VALIDATION_2026-09-08.md)。
- 五类激励广告与结算插屏适配；品牌合作每次完整广告提升一级，基础产量永久 +20%，最高 +200%，按机器换代开放等级。
- 经营记录、自动存档、离线收益、音效设置、启动健康游戏忠告及无奖励侧边栏复访。机器、粒子、装车和换代动画、音效均由代码生成。

## 立即试玩

需要 Node.js 18 或更新版本。在此目录运行：

```powershell
npm run build
npm start
```

打开[本地试玩](http://127.0.0.1:4173)。服务只监听本机。也可直接打开 `web/index.html`，浏览器存储策略可能因 file 协议而不同，建议使用本地服务。

启动后阅读健康游戏忠告，点击「开始经营」进入工厂；有待领离线收益时继续显示领取面板。点击机器或机器下方空地生产，场景左侧入口展开当前目标与推荐操作，新手默认展开。金币与自动收益位于左上角，主线订单与档位入口位于右上角，能量与点火位于场景底部。

底部「升级」查看永久升级，「订单」装车领取，「任务」查看成长奖励，「工厂」查看换代、蓝图、品牌合作和涡轮增压；设置位于「工厂」右上角。第 10 单后，从「升级」底部或「工厂」进入「风味研发」，右上「手册」查看八组课题和累计效果；「订单」提供分段交付和右上「委托」入口。完成 20 张主单并建成巨型爆米花塔后，从「工厂」进入竣工收藏。

电脑支持空格生产、1/2/3 升级、O 查看订单、M 查看换代、Q 查看成长任务、B 查看品牌合作、P 查看生产档位、Escape 关闭面板或收起主页目标；启动忠告期间不能用快捷键跳过开工。

浏览器使用模拟激励，可选择完整观看、中途关闭或加载失败，没有真实广告流量。前 90 秒不开启激励，激励之间无固定冷却，播放中拦截重复请求，普通成长始终可用。进度属于当前浏览器和来源，不跨设备同步；卸载或清理应用数据会影响存档。

## 抖音小游戏包

`npm run build` 生成 `build/douyin/`，包含 `game.js`、`game.json`、`project.config.json`、`config.js`、`game.bundle.js`。在抖音开发者工具中导入该目录进行联调。

需要联调时，在根目录创建已被 Git 忽略的 `config.local.json`，填写自己已开通的配置：

```json
{
  "appId": "你的 AppID",
  "rewardAdUnitId": "你的激励视频广告位 ID",
  "interstitialAdUnitId": "你的插屏广告位 ID",
  "analyticsEnabled": false
}
```

再次构建会读取此配置并写入发布目录，生成目录里的修改会在下次构建时被覆盖。抖音构建强制禁用模拟奖励；未填写广告位 ID 时返回不可用，生产与普通结算继续工作。抖音使用包内 WAV 原生音效，浏览器使用 WebAudio，不支持对应音频 API 时安全降级。

个人开发者账号已认证，小游戏已创建，真实 AppID 已写入本地配置。平台基础资料（介绍、分类、美食题材和图标）已保存为草稿；软著尚未办理，自审尚未完成，两个广告位仍为空。

支持的原生宿主显示「侧边栏再来玩」，设置中也可打开复访指引；只有用户点击才跳转，不发放金币或承诺礼包，导航成功不等于已从侧边栏返回。不支持该能力的宿主隐藏入口。**2026-09-06 用户已确认 Android 侧边栏问题来自未上线游戏的平台限制，原因定位结束，不再列为待排查代码故障。** 待用户恢复真机验收、且上线或测试加白解除限制后再复验。

既有 IDE、Android 操作与侧边栏证据见[抖音联调准备](docs/DOUYIN_SETUP.md)；历史版本验证不覆盖后续界面。长后台离线、长时性能、iOS 和真实广告仍待测，真机验收与软著办理继续暂停。恢复手机测试时，授权入口为后台「开发 → 开发设置 → 测试管理 → 添加设备」，由试玩的抖音账号扫码；见官方[小游戏测试设备说明](https://developer.open-douyin.com/docs/resource/zh-CN/mini-game/develop/dev-tools/game-debug/bonus-scene)。

`npm run preflight` 检查包结构与本地配置；`npm run preflight:strict` 还会将缺失广告位列为未就绪。这些检查不能替代平台权限或手机验证。

## 设计与验证

规则与数值依据：

- [风味研发](docs/CONTENT_EXPANSION_2026-09-08.md)与[永久成长节奏验证](docs/CONTENT_GROWTH_VALIDATION_2026-09-08.md)：24 次永久提升、课题手册、存档和离线规则，以及 36 条策略模拟。
- [分段交付、委托与收藏规则](docs/PROGRESSION_RULES.md)、[后期工艺数值](docs/LATE_GROWTH.md)、[成长任务](docs/QUEST_SYSTEM.md)、[品牌合作](docs/BRAND_PARTNERSHIP.md)。
- [完整首版设计](docs/GAME_DESIGN_V1.md)与[原始需求交接](GAME_DESIGN_HANDOFF.md)：保留初始设计依据，后续变化见对应专题。
- [增量游戏内容调研](docs/INCREMENTAL_CONTENT_RESEARCH_2026-09-08.md)与[UI / 玩法调研](docs/INCREMENTAL_UI_GAMEPLAY_RESEARCH_2026-09-06.md)：一手来源及适用建议。

历史实现与当时验证保留在专题文档：

- [中后期可玩性](docs/PLAYABILITY_ITERATION.md)、[工艺与成长外观](docs/GROWTH_EXPERIENCE_ITERATION.md)、[中期成长](docs/MIDGAME_MILESTONES.md)、[生产档位与回归体验](docs/PRODUCTION_MODES_ITERATION.md)。
- [侧边目标](docs/SIDE_GOAL_ITERATION.md)、[主场景布局](docs/SCENE_LAYOUT_ITERATION.md)、[目标与推荐联动](docs/GOAL_RECOMMENDATION.md)、[火候与订单反馈](docs/HEAT_ORDER_POLISH.md)、[UI 与玩法迭代](docs/UI_GAMEPLAY_ITERATION.md)、[前 5 分钟体验](docs/EXPERIENCE_PASS.md)。

验收与交付资料：

- [验收记录与待测清单](docs/ACCEPTANCE.md)、[自审核对草稿](docs/SELF_REVIEW_DRAFT.md)、[发布准备清单](docs/RELEASE_CHECKLIST.md)。
- [侧边栏平台限制与加白申请草稿](docs/SIDEBAR_TESTING.md)：平台限制已确认，申请内容尚未发送。
- [软著技术材料](docs/copyright/README.md)、[操作说明书草稿](docs/copyright/manual-draft.md)与[材料准备清单](docs/COPYRIGHT_PREPARATION.md)：已有说明书、PDF、源码快照和校验材料均保留，仍待权利人确认，不代表登记或正式交付已完成。

```powershell
npm test
npm run build
npm run preflight
```

2026-09-08 清理后，559/559 项测试、双端构建和静态预检通过。旧版固定尺寸界面已删除，必要回归已迁至当前响应式界面；两个广告位仍待配置。

测试维护以实际回归风险为准：保留存档、奖励防重复、经济计算、广告异常、抖音非 DOM 宿主及当前界面的关键交互检查。优先覆盖业务规则和已修复故障；纯样式、非业务文案或粒子密度调整默认不新增测试，也不锁死美术细节。开发时先运行相关测试，一轮改动结束后执行一次 `npm test`；没有新改动或失败原因时不重复全量运行。

复现基础数值路线：`node tests/balance.cjs`；研发成长节奏与策略说明见[专题验证](docs/CONTENT_GROWTH_VALIDATION_2026-09-08.md)。脚本通关时间不代表实际玩家体验、留存或广告收益。检查六阶段设备外观：运行 `node tools/visual-check.mjs`，再打开[视觉验收页](http://127.0.0.1:4173/visual-check.html)。

记录前 5 分钟人工试玩，可在构建后运行：

```powershell
node tools/experience-check.mjs
npm start
```

打开[常规 390×844 QA 页](http://127.0.0.1:4173/experience-check.html?mode=normal&width=390&height=844)或[低频 320×568 QA 页](http://127.0.0.1:4173/experience-check.html?mode=low&width=320&height=568)。左侧人工操作游戏，右侧父页面每秒只读采样首次升级、爆锅、领单、换代与错误，可下载 JSON。`mode` 仅区分记录和视口，不自动点击或改变游戏速度；已有存档保留并记录为基线。QA 页与视觉验收页均不进入抖音包。

本地埋点默认只存在内存中，基础记录最多 200 条，体验事件默认最多 400 条，不联网发送。正式上报须开通平台事件并在本地配置启用 `analyticsEnabled`。浏览器提供只读诊断 `__POPCORN__.snapshot()` / `.analytics()` / `.experience()`，不向玩家暴露调试修改入口。广告完成回调、实际发奖和广告后 30 秒的经营进展分别记录，不能解释为真实广告收入或广告造成的净增收益。

## 文件分工

| 文件 | 用途 |
| --- | --- |
| `src/core.js` | 数值、生产、订单、成长任务、研发、升级、离线、奖励与存档校验 |
| `src/renderer.js` | Canvas 绘图、生产场景、动画反馈与命中区域 |
| `src/interface.js` | 响应布局、当前目标、推荐升级、面板、分页和奖励预览 |
| `src/production-scene.js` | 六阶段机器、连续出料、爆锅粒子、装车与换代动画 |
| `src/experience.js` | 目标选择、首次事件、广告漏斗与只读体验导出 |
| `src/main.js` | 主循环、触摸、键盘、界面流程、自动保存与生命周期 |
| `src/platform.js` | 浏览器／抖音 API、广告、存储、生命周期、侧边栏检测与导航、埋点 |
| `src/audio.js` | 原创程序化音效和降级 |
| `tools/build.mjs` | 无依赖 CommonJS 打包及双端输出 |
| `tools/serve.mjs` | 本地试玩服务 |
| `tools/experience-check.mjs` | 生成本地人工试玩的只读 QA 父页面，不进入抖音包 |
| `tests/` | 核心、平台与集成回归 |
