# UI 三件新增美术交接

A0 在 POP/SHIP 封板后追加授权本有界子任务。仅写本 UI 包；正式界面、数值与运行代码未改。

实际新增 3 张 PNG：`ui_icon_automation`（92×96）、`ui_badge_generation`（96×94）、`ui_badge_complete`（96×95），合计 32,941 字节。最终文件在 `exports/`，原尺寸图在 `sources/`。三个资产均首轮内置 `image_gen.imagegen` 成功，无 CLI/API、无失败图。

实际查看并沿用既有 settings/check 图标、card 底板及原 UI 图风格。自动循环图标由青绿循环箭头+金色齿轮构成；代际徽章留空中央供后续单独绘制 1–6，原 PNG 没有数字；完成徽章用独立盾牌勾号。全部没有文字、价格或金额，不新增六套皮肤。

`prompts.jsonl` 保留完整实用提示词与参考路径；`provenance.json` 记录参考/原图/导出 SHA、结果 ID，tool 未提供 model/seed，明确为 unavailable。`export-recipe.json` 记录 alpha 裁切、等比缩小及 2px 透明边距。

已执行 PNG 签名/真实 alpha、SHA、尺寸、完整轮廓、三底目检及 32/48/96 像素尺寸目检。证据：`alpha-three-backgrounds.png`、`ui-size-preview.png`。生成/导出/局部装配分别为 GENERATED/EXPORTED/ASSEMBLED_ART_ONLY；三件不含代码，现有底板/图标/FX 继续复用。

完整 UI 状态、两视口、v15 数值检查由 A0/A7 合并预览负责，本子任务 NOT_RUN；正式构建、状态绑定与真机 NOT_RUN。下一依赖为 A0/A7 合并验收。禁止路径写入：无。

导出复现：`powershell.exe -NoProfile -ExecutionPolicy Bypass -File art-source/six-gen/ui/export-assets.ps1`。
