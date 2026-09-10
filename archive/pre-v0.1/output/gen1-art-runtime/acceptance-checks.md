# 首代正式入口：已保存运行证据独立核验

审计时间：2026-09-09T15:05:11.924Z。核验结果：通过。HTTP 数量是该审计时刻的固定快照，后续录屏上传不会改写本次结论。

按“夹具＋尺寸＋安全区＋面板状态”选最新时间戳，共 10 组 PNG/JSON，并复制到 evidence 稳定名称；原始文件全部保留。全部为 41/41 资源已加载、failed=0、pending=0、运行错误=0；点击区均不小于 44×44，全部位于有效安全区内。三工位、两仓、9 个路径连接均存在，最大端口误差 1.1719e-13 px。每组 jobs 与库存绑定一致，库存和金币守恒，真实 core 存档校验通过。

只验收首代新视觉。双满仓为守恒视觉边界夹具，不宣称首代自然生产可达到待发满仓；第 2—6 代新美术未纳入本次验收。

## 即时首杯改造主证据

选用 [升级前 PNG](evidence/first-cup-before-320x524-browser-expanded.png) / [JSON](evidence/first-cup-before-320x524-browser-expanded.json) 和 [购买后折叠 PNG](evidence/first-cup-before-320x524-browser-collapsed.png) / [JSON](evidence/first-cup-before-320x524-browser-collapsed.json)。

320×524：金币 39→9、cup 等级 0→1；旧批次始终 amount=1、durationTicks=60、remainingTicks=18、progress=0.7。购买只扣 30 金币，未即时增加出货、未清仓；折叠后保留“查看下档”，无直接再次购买区域。

早期异步捕获及被替代文件不作为该瞬时状态的主证据。390 px 折叠截图用于折叠画面和恢复生产后的状态，其后续金币/批次不冒充购买瞬间。

## 选用的最新静帧

| 夹具 / 尺寸 / 安全区 / 面板 | 稳定文件 | 原始选用文件 | 结果 |
|---|---|---|---|
| both-full-boundary-320x524-safe-collapsed | [PNG](evidence/both-full-boundary-320x524-safe-collapsed.png) / [JSON](evidence/both-full-boundary-320x524-safe-collapsed.json) | both-full-boundary-320x524-safe-collapsed-still-1788965751643.png / both-full-boundary-320x524-safe-collapsed-still-1788965751643.json | 通过 |
| both-full-boundary-320x524-safe-expanded | [PNG](evidence/both-full-boundary-320x524-safe-expanded.png) / [JSON](evidence/both-full-boundary-320x524-safe-expanded.json) | both-full-boundary-320x524-safe-expanded-still-1788965718151.png / both-full-boundary-320x524-safe-expanded-still-1788965718151.json | 通过 |
| both-full-boundary-390x844-safe-expanded | [PNG](evidence/both-full-boundary-390x844-safe-expanded.png) / [JSON](evidence/both-full-boundary-390x844-safe-expanded.json) | both-full-boundary-390x844-safe-expanded-still-1788965689427.png / both-full-boundary-390x844-safe-expanded-still-1788965689427.json | 通过 |
| first-cup-before-320x524-browser-collapsed | [PNG](evidence/first-cup-before-320x524-browser-collapsed.png) / [JSON](evidence/first-cup-before-320x524-browser-collapsed.json) | first-cup-before-320x524-browser-collapsed-still-1788965858698.png / first-cup-before-320x524-browser-collapsed-still-1788965858698.json | 通过 |
| first-cup-before-320x524-browser-expanded | [PNG](evidence/first-cup-before-320x524-browser-expanded.png) / [JSON](evidence/first-cup-before-320x524-browser-expanded.json) | first-cup-before-320x524-browser-expanded-still-1788965848324.png / first-cup-before-320x524-browser-expanded-still-1788965848324.json | 通过 |
| first-cup-before-320x524-browser-home | [PNG](evidence/first-cup-before-320x524-browser-home.png) / [JSON](evidence/first-cup-before-320x524-browser-home.json) | first-cup-before-320x524-browser-home-still-1788964928025.png / first-cup-before-320x524-browser-home-still-1788964928025.json | 通过 |
| first-cup-before-390x844-browser-collapsed | [PNG](evidence/first-cup-before-390x844-browser-collapsed.png) / [JSON](evidence/first-cup-before-390x844-browser-collapsed.json) | first-cup-before-390x844-browser-collapsed-still-1788965630182.png / first-cup-before-390x844-browser-collapsed-still-1788965630182.json | 通过 |
| first-cup-before-390x844-browser-expanded | [PNG](evidence/first-cup-before-390x844-browser-expanded.png) / [JSON](evidence/first-cup-before-390x844-browser-expanded.json) | first-cup-before-390x844-browser-expanded-still-1788965577557.png / first-cup-before-390x844-browser-expanded-still-1788965577557.json | 通过 |
| fresh-shortage-320x524-browser-home | [PNG](evidence/fresh-shortage-320x524-browser-home.png) / [JSON](evidence/fresh-shortage-320x524-browser-home.json) | fresh-shortage-320x524-browser-home-still-1788965795540.png / fresh-shortage-320x524-browser-home-still-1788965795540.json | 通过 |
| fresh-shortage-390x844-browser-home | [PNG](evidence/fresh-shortage-390x844-browser-home.png) / [JSON](evidence/fresh-shortage-390x844-browser-home.json) | fresh-shortage-390x844-browser-home-still-1788965807880.png / fresh-shortage-390x844-browser-home-still-1788965807880.json | 通过 |

first-cup-before 的 320 px home 是该组最新但较早的首页辅助证据；最终缺料首页以及最新展开/折叠截图是主要证据。

## HTTP 与正式资源路径

记录文件：[request-report.json](runtime-captures/request-report.json)。287 次 PNG 请求全部返回 200，覆盖 41 个唯一运行 PNG 路径；HTTP 错误 0。正式 bundle 7 次请求均为同一路径 /game.bundle.js，全部 200。服务读取正式 web/index.html 与 web/game.bundle.js，没有替代 preview 页面。

最终 bundle 响应 137671 B，与当前正式构建 137671 B 一致；SHA-256：9edaff9b9d69dfa886f0b3e6ed4856b5cc3f675bf505d3a81926589b655f3f46。

## 最新短录屏

- [first-cup-before-320x524-browser-collapsed-motion-1788966054917.webm](runtime-captures/first-cup-before-320x524-browser-collapsed-motion-1788966054917.webm) / [诊断 JSON](runtime-captures/first-cup-before-320x524-browser-collapsed-motion-1788966054917.json)：8.01 秒，35538 B，开始/结束错误 0/0。折叠状态辅助片段：QA 时钟推进，但保存的生产快照金币仍 9、累计出货仍 39，不能作为持续生产主证据。
- [first-cup-before-320x524-browser-expanded-motion-1788965852772.webm](runtime-captures/first-cup-before-320x524-browser-expanded-motion-1788965852772.webm) / [诊断 JSON](runtime-captures/first-cup-before-320x524-browser-expanded-motion-1788965852772.json)：8.02 秒，61069 B，开始/结束错误 0/0。冻结生产时钟下的真实购买及折叠：金币 39→9、cup 0→1；与最新静帧对共同证明旧批次未重置。
- [first-cup-before-390x844-browser-expanded-motion-1788965605762.webm](runtime-captures/first-cup-before-390x844-browser-expanded-motion-1788965605762.webm) / [诊断 JSON](runtime-captures/first-cup-before-390x844-browser-expanded-motion-1788965605762.json)：8.03 秒，1478531 B，开始/结束错误 0/0。真实购买并恢复生产：累计出货 39→82、金币 39→52（含扣款30），用于持续生产主证据；瞬时旧批次证据使用最新320 px静帧对。

## 排除的被替代静帧诊断

- first-cup-before-320x524-browser-collapsed-still-1788964956228.json
- first-cup-before-320x524-browser-expanded-still-1788964948474.json
- first-cup-before-320x524-browser-home-still-1788964837138.json
- first-cup-before-390x844-browser-expanded-still-1788965566445.json

完整逐项布尔断言、几何值、文件哈希和唯一 PNG 路径见 [acceptance-checks.json](acceptance-checks.json)。
