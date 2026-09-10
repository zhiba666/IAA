# 第六部分｜Codex 多 agent 并行编排

## 角色与唯一写入权

| Agent | 职责 | 唯一写入范围 |
|---|---|---|
| A0 总控/美术技术负责人 | 基线审计、契约、样板评审、任务派发、合并及变更裁决 | `art-source/six-gen/contracts/`、`references/`、`integration/`、`reports/` |
| A1 爆锅 | 双/四/六头机壳、托具、插槽 rig | `art-source/six-gen/pop/` |
| A2 装杯 | 双/三/四/六头机壳、杯位、独立工作头 rig | `art-source/six-gen/cup/` |
| A3 出货 | 双/四道机壳，双杯/箱装复用及适配 | `art-source/six-gen/ship/` |
| A4 物流 | 仓位扩展、桥接、托盘与入口 | `art-source/six-gen/logistics/` |
| A5 UI/FX | 底板/图标复用，新增 3 件，状态稿与动效规则 | `art-source/six-gen/ui/` |
| A6 场景 | 六代两态布局、环境扩展和塔体 | `art-source/six-gen/scene/` |
| A7 独立 QA | 数据/图片审计，尺寸/状态截图，缺陷单 | `art-source/six-gen/qa/` |

这是 8 个角色，不要求同时启动 8 个进程。建议活跃制作 4–6 路，图像生成并发先 2 路；按实际工具和配额调整，不承诺账号能力。A7 只写报告，不能悄悄覆盖别人的图；缺陷回派资产原作者。

## 不按代数各画一套
同一个部件只能有一个拥有者。G02/G03 使用同一双头壳，G04/G05 可以共享四头爆锅壳，G05/G06 共用四道出货壳。场景 agent 不重做机器；UI agent 不生成金币数值；物流 agent 不重新生成纸杯。六代任务只组合同一共享库。

## 并行依赖图
```
Gate 0：A0 基线/能力审计 + A7 审计框架
    ↓ 冻结 reference-lock / style-contract / asset-contract
Gate 1：A1 双头壳样板 + A2 双头壳样板 + A3 箱装复用试样
        A4 端口样板 + A5 UI复用样板 + A6 G02/G06灰盒布局（并行）
    ↓ 跨组拼接、风格、预算样板验收
Gate 2：A1–A6 批量制作（按资源家族并行）
    ↓ 各包锁定验收版本，A0 合并
Gate 3：A6 六代正式装配 + A5 状态装配 + A7 独立验收
    ↓
阶段 A 资源交付完毕
    ↓ 仅在额外授权后
Gate 4：单一集成人执行运行接入与双端回归
```

A6 在灰盒阶段可使用明确标为占位的框架做几何验证，但最终交付的 PNG/预览不得包含占位机器。缺依赖时写 BLOCKED，不能把灰盒截图计为完成。

## 分支与交接
推荐一个 agent 一个 worktree/分支，所有 worker 从同一份已冻结的契约提交开始。Codex 支持 subagents 与 worktree，但并行写入仍需要人为明确的所有权；不能假设子 agent 天生有独立文件系统。[O1][O2]

共享文件只由 A0 合并。先合并契约，再合并公共物流/UI，再合并设备，再装配/QA；已经验收的输入用 SHA 锁定。worker 用最新本包候选提交和 HANDOFF 交接，不能在其他包还写入时读取半成品。

禁止 worker 写 `assets/art/manifest.json`、`src/art-manifest.js`、`src/core.js`、`src/factory-rules.js`、正式构建目录、根级 AGENTS.md 或他人未提交文件。已有批次导出脚本可能回写全局清单；只复制/适配到 staging 后运行。尤其不要运行批次 0 的旧 `write-manifest.cjs` 覆盖汇总清单。[R3]

## 任务生命周期
`PLANNED → READY → RUNNING → REVIEW → ACCEPTED`；异常为 `BLOCKED / CHANGES_REQUIRED`。PLANNED 不等于资源存在，ACCEPTED_ART 不等于 ACCEPTED_RUNTIME。每次返回：文件路径、实际数量、输入 SHA、执行检查、证据路径、缺陷、下一依赖、是否触及禁止路径。未实跑的测试必须写 NOT_RUN。

