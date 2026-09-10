# 正式入口录屏文件检查

使用本地 PyAV / FFmpeg 库读取原始 VP9 帧与 PTS。未改绘、变速或补帧；源录屏全部保留。

唯一主录屏：`../gen1-upgrade-390x844.webm`，由正常 390×844 源视频逐字节复制，SHA-256 一致，无裁切或重编码。

320×524 三片仅为诊断材料，不计生产流畅性证据。两尺寸静态画面、状态及触控检查见正式入口 PNG 与验收报告。曾生成的 `gen1-upgrade-320x524.webm` 派生副本已删除，源文件未删除。

## first-cup-before-320x524-browser-expanded-motion-1788964948500.webm

- 271,553 bytes；vp9；320×524；成功解码 133 帧。
- 视频 PTS 0.000–6.135 秒；metadata 墙钟 536.035 秒。
- 超过 250 ms 帧间隔：[{"fromSeconds": 4.138, "toSeconds": 5.478, "gapSeconds": 1.34}, {"fromSeconds": 5.702, "toSeconds": 6.135, "gapSeconds": 0.433}]。

诊断：工具冻结使墙钟记录达到 536 秒；有效编码 PTS 只覆盖约 6.136 秒，含 1.34 秒断档。不作为主交付，无需裁成 8 秒。

- first：第 0 帧，PTS 0.000 秒，`first-cup-before-320x524-browser-expanded-motion-1788964948500-first.png`。
- middle：第 91 帧，PTS 3.062 秒，`first-cup-before-320x524-browser-expanded-motion-1788964948500-middle.png`。
- last：第 132 帧，PTS 6.135 秒，`first-cup-before-320x524-browser-expanded-motion-1788964948500-last.png`。

## first-cup-before-390x844-browser-expanded-motion-1788965605762.webm

- 1,478,531 bytes；vp9；390×844；成功解码 234 帧。
- 视频 PTS 0.000–7.793 秒；metadata 墙钟 8.028 秒。
- 超过 250 ms 帧间隔：[]。

主录屏：234 帧、无超过 250 ms 的帧间隔；已目视核对购买报价、安装后折叠与库存消耗（待装 12→4→0，金币 39→31→52）。该视频来自大屏装杯标签位置微调前的构建；保留录制原貌，最终标签布局以最终截图为准。

- first：第 0 帧，PTS 0.000 秒，`first-cup-before-390x844-browser-expanded-motion-1788965605762-first.png`。
- middle：第 116 帧，PTS 3.890 秒，`first-cup-before-390x844-browser-expanded-motion-1788965605762-middle.png`。
- last：第 233 帧，PTS 7.793 秒，`first-cup-before-390x844-browser-expanded-motion-1788965605762-last.png`。

## first-cup-before-320x524-browser-expanded-motion-1788965852772.webm

- 61,069 bytes；vp9；320×524；成功解码 12 帧。
- 视频 PTS 0.000–7.367 秒；metadata 墙钟 8.022 秒。
- 超过 250 ms 帧间隔：[{"fromSeconds": 0.247, "toSeconds": 1.264, "gapSeconds": 1.017}, {"fromSeconds": 1.264, "toSeconds": 2.271, "gapSeconds": 1.007}, {"fromSeconds": 2.271, "toSeconds": 3.276, "gapSeconds": 1.005}, {"fromSeconds": 3.276, "toSeconds": 4.283, "gapSeconds": 1.007}, {"fromSeconds": 4.283, "toSeconds": 5.288, "gapSeconds": 1.005}, {"fromSeconds": 5.337, "toSeconds": 6.361, "gapSeconds": 1.024}, {"fromSeconds": 6.361, "toSeconds": 7.367, "gapSeconds": 1.006}]。

诊断：刻意暂停 QA 时间以保留首次升级的旧批次，用于检查购买瞬间及折叠；中末帧静止符合预期。不计生产流畅性证据。

- first：第 0 帧，PTS 0.000 秒，`first-cup-before-320x524-browser-expanded-motion-1788965852772-first.png`。
- middle：第 5 帧，PTS 3.276 秒，`first-cup-before-320x524-browser-expanded-motion-1788965852772-middle.png`。
- last：第 11 帧，PTS 7.367 秒，`first-cup-before-320x524-browser-expanded-motion-1788965852772-last.png`。

## first-cup-before-320x524-browser-collapsed-motion-1788966054917.webm

- 35,538 bytes；vp9；320×524；成功解码 10 帧。
- 视频 PTS 0.000–7.111 秒；metadata 墙钟 8.011 秒。
- 超过 250 ms 帧间隔：[{"fromSeconds": 0.071, "toSeconds": 1.077, "gapSeconds": 1.006}, {"fromSeconds": 1.077, "toSeconds": 2.083, "gapSeconds": 1.006}, {"fromSeconds": 2.083, "toSeconds": 3.089, "gapSeconds": 1.006}, {"fromSeconds": 3.089, "toSeconds": 4.096, "gapSeconds": 1.007}, {"fromSeconds": 4.096, "toSeconds": 5.1, "gapSeconds": 1.004}, {"fromSeconds": 5.1, "toSeconds": 6.106, "gapSeconds": 1.006}, {"fromSeconds": 6.106, "toSeconds": 7.111, "gapSeconds": 1.005}]。

诊断：Chrome 后台 RAF 节流，约每秒一帧；生产核心将超过阈值的帧间隔按后台停顿正确跳过。此片不计生产流畅性验收，也不据此推断生产停机缺陷。

- first：第 0 帧，PTS 0.000 秒，`first-cup-before-320x524-browser-collapsed-motion-1788966054917-first.png`。
- middle：第 5 帧，PTS 3.089 秒，`first-cup-before-320x524-browser-collapsed-motion-1788966054917-middle.png`。
- last：第 9 帧，PTS 7.111 秒，`first-cup-before-320x524-browser-collapsed-motion-1788966054917-last.png`。
