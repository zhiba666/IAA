# 小小爆米花厂 · 2.0.0

原生 Canvas + JavaScript 轻经营流水线游戏，同一正式入口构建浏览器与抖音小游戏包。当前生产循环为：观察瓶颈 → 比较改造影响 → 改善出货 → 赚钱扩建。

## 接续开发入口

- **本任务范围**：[当前开发重心](docs/DEVELOPMENT_FOCUS.md)。本轮只清理误导性资料和废弃工具，不新增玩法或美术。
- **当前实现**：以 `src/`、`tests/`、`tools/build.mjs` 和实际执行结果为准；本文件概述生产与平台边界。
- **已选美术基准**：[工厂与 UI 资源](output/imagegen/popcorn-ui-20260909/)、[美术路线及清理记录](docs/ART_DIRECTION_AND_CLEANUP_2026-09-09.md)。旧截图仅作历史运行证据。
- **制作方案**：[美术资源计划](docs/ART_ASSET_ADDITION_PLAN_2026-09-09.md)。计划、整图及示例金额不等于已实现功能或经济配置。素材制作进展见 `art-source/` 与 `assets/art/`；是否接入游戏以当前源码和实际构建为准。
- **历史资料**：`archive/` 不提供当前开发指令。旧图标、运行证据及原 `docs/copyright/`、`deliverables/` 材料已移入 [本次归档](archive/retired-2026-09-09/)。`.rgignore` 将历史资料排除出默认 `rg` 检索；追溯时显式使用 `rg --no-ignore <关键词> archive`。

工作区可能包含并行任务的美术接入修改；清理不删除这些修改，也不以旧报告的测试数量宣称它们已完成或已验收。

## 运行与检查

需要 Node.js 18 或更新版本，无 npm 运行依赖。

```powershell
npm run build
npm start
npm test
npm run preflight
```

[浏览器正式入口](http://127.0.0.1:4173)仅监听本机。`npm test` 先构建当前源码；`preflight:strict` 可作更严格静态检查，不能替代真机或账号权限验证。`build:dev` 仍禁用连点和模拟广告。

`tools/build.mjs` 生成 `web/game.bundle.js` 与 `build/douyin/`，不要手改生成包。素材目录中存在 PNG 不代表已进入双端包；以构建实现及产物核查为准。本地 `config.local.json` 不被构建改写，格式见 [配置示例](config.local.example.json)。

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
| `src/production-scene.js`、`src/interface.js`、`src/renderer.js` | 场景、界面与命中映射 |
| `art-source/`、`assets/art/` | 并行任务的美术源文件与导出素材；保留，制作状态由该任务维护 |
| `src/main.js`、`src/platform.js`、`src/audio.js` | 正式入口、输入/报价、生命周期、平台与声音 |
| `tools/build.mjs`、`tools/bundle.mjs`、`tools/serve.mjs`、`tools/preflight.mjs` | 构建、打包、本地服务与预检 |
| `tests/` | 当前源码的技术回归 |

旧界面截图、旧测试数量和旧包体记录已退出当前完成状态说明；追溯时见 [清理前入口快照](archive/pipeline-v2/README_BEFORE_DOC_CLEANUP_2026-09-09.md)。当前代码是否通过，以本次运行结果为准。
