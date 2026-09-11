# v1.1 墙角层

最终素材：`exports/factory_wall_corner.png`，512×214，24,913 bytes，真实 alpha。保留比例，勿拉伸为 512×256。

用于竖屏背景顶部，按屏幕宽度等比铺开，锚点为上中 `[256,0]`；先铺独立米色地面，再绘制本墙角层。踢脚线中央高、两侧低，墙面顶部与左右边缘自然出界。中央墙脚位约 `[256,97]`，两侧约 y=181。

内置 `image_gen` 共生成三次：前两次输出 RGB 和画出的棋盘格，已标记拒绝并保留原图；第三次不带失败参考，成功生成真实 RGBA。最终原图为 `sources/factory_wall_corner_attempt_03.png`，不做程序抠图。仅裁掉顶部 144px 空白、等比缩小并压缩 PNG。原图中的墙面 alpha 约 252–254，视觉近乎不透明；下方空区为 alpha 0。

已目检原图、导出 PNG 和 `previews/wall-three-backgrounds.png` 的米色、深青色、白色背景：无棋盘格、无明显白边，底边轮廓与透视方向正确，顶边连续、左右铺满。机械检查确认真实 alpha 和 60KiB 预算通过。

`prompts.jsonl` 保存三次完整提示词；`prompt.txt` 为最终选用提示词；`provenance.json` 与 `export.json` 保存来源、SHA、尺寸、alpha 统计及导出参数。复跑：`node art-source/v1.1/wall/export.cjs`。

状态为 EXPORTED_ART_ONLY。未修改正式资源清单、游戏代码、数值、存档或构建产物；运行适配与真机验收尚未执行。
