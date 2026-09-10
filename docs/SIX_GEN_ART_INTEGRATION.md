# 六代美术代码接入

当前软件版本为 [v0.1 正式版](releases/v0.1.md)。当前构建从 `art-source/six-gen/integration/legacy/batch-0-assembly.json` 与 `art-source/six-gen/integration/legacy/batch-1-machinery-assembly.json` 读取复用装配，独立于历史归档和临时工作树；六代最终清单和 84 张 PNG 保留活动路径。装配来源与维护说明见 [活动装配目录](../art-source/six-gen/integration/legacy/README.md)。下文保留原接入阶段的技术说明和验证边界，v0.1 发布时的检查结果见发布说明。

本轮由“只生成美术”进入用户明确授权的代码接入阶段。基线为 `14310d34e882969208bb7583c5e0c8442bfc3aee`；实现和验收先在隔离工作树进行，再同步回 IAA 工作区。候选原图、最终 PNG 及阶段 A 验收历史不改写。

## 正式入口

`Renderer → SixGenerationScene` 覆盖六代工厂；首代复用已验收的原装配坐标。多头共用机身，每个槽位读取实际已购 `lanes`，每个机头读取对应 `jobs[i]` 的进度、份数和完成状态。扩建只换可容纳更多设备的机身，未购槽位保留盖板。双杯托盘、四杯箱及缓冲仓代表物使用已有分层素材与遮罩。

库存、入口、工作批次和收入只读真实生产快照。升级保留尚未完成的旧批次；真实结算事件驱动出货反馈。美术不调用奖励、库存转移或结算接口。核心规则、价格、升级条件、存档键与迁移格式不变。

六代共用 PNG 面板、按钮、HUD、自动化图标和代际/完成徽章。第六代建成与全部改造完成分别显示。加载错误有可点击的重试入口；取消预留提示货物仍在源仓。二至六代两段都已自动化且未持货时，转运栏收为 64 px；手持货物或未接通时保留两行操作。

## 资源与加载

构建只接受 `art-source/six-gen/integration/manifest.json` 的 84 个最终 PNG，原始参考与生成大图不进入发布包。18 组工位装配、物流、场景、包装契约由构建器生成进 `src/art-manifest.js`。禁止手改生成文件；使用 `npm run build` 重建。

每个运行文件位于 `assets/art/six_gen/`。构建验证 SHA-256、PNG 签名与尺寸、引用、矩形和预算，再分别复制到 Web 与抖音目录并逐文件比对。九宫格边界跟随原 UI 图的降采样比例。

本轮明确采用**全量预载一次并缓存**：84 个 PNG 共 1,846,247 B（1.76 MiB），低于计划首包 2 MiB 和完整 4 MiB；RGBA 基础估算 26,848,144 B（25.60 MiB），低于 32 MiB。转代复用同一图片缓存，不创建第二套图片，也不卸载共享纹理。按代依赖预算仅用于资源统计，不宣称已实现懒加载。RGBA 数值不是 GPU 或进程实测内存。

失败图片可单独重试，已成功加载的图片不重复解码。全量预载避免转代时额外请求；缺失机器可明确使用同位置的 Canvas 降级表现，恢复后自动绘制 PNG。

## 动效契约

`src/art-effects.js` 集中定义纯表现参数。安装反馈 2 秒，PNG 复用亮点素材，Canvas 降级显示 3 个亮点；出货反馈 0.65 秒，合并间隔 0.75 秒。安装事件来自真实升级/扩建/自动化/物流购买。出货动画读取已结算的份数与金币，只展示回执。机头位移和蒸汽跟随真实批次进度，缺料或完成堵塞时不继续推进。

## 可复跑验收

```powershell
npm test
npm run preflight
node tools/automation-balance.cjs
node tools/six-gen-acceptance.mjs
node tools/six-gen-acceptance.mjs --serve --port 4196
```

验收服务使用独立 localhost 端口和经 `Game` 恢复校验的测试存档，运行正式 `web/index.html` 与 `game.bundle.js`。控制台提供状态、两种视口、安全区、单步、PNG 和录屏；测试存档不进入发布包。所有边界状态与自然经营状态分别标注。PNG 与旁侧 JSON 保留实际快照、资源 SHA、布局、错误、时间和基础帧时序。

接入阶段的执行结果记录在 `output/six-gen-runtime/`，其中旧截图和报告注明对应 bundle SHA；资源报告在 `output/six-gen-art-runtime/`，随当前构建重算。真机和抖音 IDE 设备表现为 `NOT_RUN`，本地测试与浏览器验收不代替设备验收。当前 GitHub 版本发布范围见 [v0.1 发布说明](releases/v0.1.md)。
