# v1.1 教学手势

已使用内置 `image_gen.imagegen` 制作，导出为 `exports/ui_gesture_hand.png`，128 × 128，PNG 真透明通道，6,211 bytes。原图保留于 `sources/ui_gesture_hand.png`。

提示词和来源可查看 `prompts/ui_gesture_hand.txt`、`provenance.json`、`tool-result.json`。精确裁切、缩放、SHA-256、透明通道检验及锚点见 `ui_gesture_hand.export.json`；工具没有返回 seed，记录为 `unavailable`。

用法：建议显示为 32–40 逻辑像素，左上方向的食指尖为操作目标，导出像素锚点为 `[17, 9]`，归一化锚点为 `[0.1328125, 0.0703125]`。移动、按压和拖拽由程序动画表达，图中没有文字、箭头或动作波纹。透明安全边至少为 4 像素。

已用 `view_image` 检查源图、导出图和 `previews/hand-three-backgrounds-128-32-40.png`：奶油浅底、深青底与青绿机器底均可读，32 px 和 40 px 缩小后仍可识别手势，未见裁切缺损或背景矩形。暂不需要重做。后续建议先接入代码并检验动态位置、手指尖对齐和手势遮挡，按实际场景再决定是否调整。

当前仅补充美术交付，未更改正式素材清单或游戏逻辑。
