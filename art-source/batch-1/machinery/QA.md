# 首代机械 / 输送 / 待发仓资源校对

日期：2026-09-09。仅制作美术资源；未接入游戏。

本目录交付 6 套功能组件、14 张独立 RGBA PNG。最终机体最长边 512 px、工作头 256 px、输送与仓体 512 px、前挡不超过 384 px；装配画布保留设计坐标，通过等比缩放引用 PNG。

- 灰色爆锅：机体、升降盖/搅拌头、近侧锅壁；空锅和加工状态共用同一套部件，内容使用批次 0 的填充图。
- 青绿出货：宽空腔机体、独立压头、低前栏；静态检验包含空机、单杯、双杯托、四杯开箱。包装复用 `../core/assembly.json`。
- 输送：转接、入料、出料三类，每类带面/底架与前栏分开。转接前栏使用重生成的倒 V 方向，前栏能遮住产品底部。
- 待发仓：等距菱形后壳与低前栏；前栏左右复用一个 PNG，右侧在装配时镜像。空、少量、满仓使用 0/1/6 个代表性杯子，不表示运行时实际数量。

`assembly.json` 是可调整的部件、插槽、锚点、输入/输出、内容与地面裁切坐标；`assembly.svg` 为嵌入独立 PNG 的可编辑静态布局源，不是可逐顶点编辑的矢量模型。`assembly-preview.png` 校对 12 种部件组合，`contact-sheet.png` 校对独立透明件。

生成采用内置 `image_gen`。每次提示词、生成源图及工具返回路径均保留在 `*-prompt.txt`、`*-source.png`、`provenance*.json`。原始 transfer 前栏方向不适配；transfer-v2 编辑输出棋盘格被实际 alpha 检查判为不透明，未导出。初稿 buffer 视角过浅，改用 buffer-v2 后壳和 buffer-front 单件。最终所用源图以 `export-recipe.json` 为准，未采用源不进入运行资产。

导出沿用批次 0 的机械连通部件分离流程：定位 alpha≥128 的主体，保留其周围两源像素邻域内的原始 alpha，再等比降采样。未抠成白底、未重绘、未用颜色键擦背景。导出检查结果见 `alpha-audit.json`：14 张全部有真实透明与实体像素，裁切边界没有 alpha≥128 的像素。几何、生成细节与可视层叠进行了人工预览核对；正式游戏的状态绑定、点击区域与屏幕验收仍待另行授权接入。

重建命令（项目根目录）：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File art-source/batch-1/machinery/export.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File art-source/batch-1/machinery/inspect-alpha.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File art-source/batch-1/machinery/contact-sheet.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File art-source/batch-1/machinery/build-preview.ps1
node art-source/batch-1/machinery/build-assembly.cjs
```
