# Gate 1 静态预览框架与密度检查

已生成可重放 SVG、PNG 及同名 JSON 证据，均位于 `qa/previews/`。运行 `node art-source/six-gen/qa/render-static-previews.cjs gate1` 可重新产生当前样板。

- `gate1-g06-density-graybox-390x844.png` / `gate1-g06-density-graybox-320x524.png`：左上爆锅 → 右待装仓 → 左中装杯 → 右待发仓 → 左下出货的 S 形排列。6/6/4 工作头使用既有真实透明图，杯体与 UI 同样复用。机壳为明确标出的灰盒，仅检查密度，不能计入美术交付。
- `g01-entry-390x844.png` / `g01-entry-320x524.png`：使用三工位旧 rig、两仓和连续输送模块。各模块输入/输出坐标精确相接，未横拉机器或输送带。圈出的两入口各有 44×44 独立触控参考。
- `gate1-g02-pop-pair-390x844.png` / `gate1-g02-pop-pair-320x524.png`：新 POP 双槽壳配共享工作头/前挡。这里只证明 POP 双头局部；不代表 CUP 或整个 G02 已完成。
- `warehouse-48-fixture-contact.png`：6 代 × 2 仓 × empty/one-portion/half/full。数量旁标注“静态样例”。真实容量由快照的 fresh stage floor 提供；实际存档容量可能更高。高代仓仅一份仍保留可见产品。
- `machine-54-state-contact.png`：6 代 × 3 工位 × 3 状态。缺少真实 rig 的格子明确标“待真实机壳 / 装配”，不会用灰盒或旧机壳冒充完成。

已独立查看两张 G06 灰盒、两张 G01、G02 小屏局部及 48 仓 contact。G01 顶部间距已调整，使标题/HUD 的内容避开 24 px 顶部安全区；保留明示无真实数据的“—”，不虚构金币或产出。G01 小屏的单份产品仍可见，三工位与两仓可区分。灰盒工作头能分别计数，入口标识保持独立。

54 格可达性审查有 42 个合法静态候选、12 个 N/A：正常 settle 后 POP 不会等待不存在的采购原料；SHIP 完成直接结算，不存在输出仓堵塞。N/A 不计为通过。依据来自 `src/core.js` 的批次结算、开始和 getView 状态映射，未执行游戏/存档测试。另有 `mixed-and-batch-fixtures.json`，对多头混合状态及旧 1 份 / 新 2 份批次分别保留样例。

最终还需：全部 18 个代际工位映射有真实 rig；新大仓/货架替换目前旧仓的局部视觉复核；6 代 entry/upgraded × 两视口完整 24 张成图；最终机壳局部遮挡/接缝及依赖预算核查。以上未完成前不标记 VERIFIED_ART。`final` 渲染模式会因缺少任一代工位真实 rig 而停止，不以占位图补齐。

程序接口支持 `rigs[]` 的 `stationId`、`generationUse[]`、`size`、`input/output`、`layers[{id,rect,layer}]` 和 `slots[{head,cover,cup/content,clip}]`。独立图像仍由各包负责；此目录只保存预览、fixtures 和审查证据。
