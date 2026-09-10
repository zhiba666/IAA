# 六代美术代码接入验证

状态：VERIFIED_RUNTIME。真机：NOT_RUN。未发布。

- 最终自动测试 221/221；本轮基线 210/210。
- 84 张 PNG，1.76 MiB；RGBA 基础估算25.60 MiB，全部预算通过。
- Web 与抖音包逐文件 SHA 一致，原始图/预览/测试 fixture 不进入包。
- [正式 Chrome 24 张基础截图](capture-report.md)：六代入代/满配 × 390×844/320×524，全部加载84/84且无运行错误。
- [小屏总览](contact-320.png) / [大屏总览](contact-390.png)。
- 288 组界面布局回归；54 格机器状态（42合法、12 N/A）；48 项仓量验证。
- 浏览器实测失图83/84→重试84/84，币值与库存原样保持；预留4份→Escape取消，源仓仍24份。
- 第六代前后塔架、双杯托盘、四杯箱、封箱出货、满级徽章均已接入。
- 核心生产、经济规则、平台存档与迁移源码内容未变（统一LF比较；未复制这些原文件）；经济模拟仍达96份/秒。

本地预检代码部分通过；已保留原有小游戏AppID，格式预检通过但平台状态待确认，抖音IDE与真机操作仍未验证。录屏受Chrome后台节流影响，不能当作前台帧率或设备性能证据。

[测试日志](verification/tests.txt) · [预检日志](verification/preflight.txt) · [经济回归](verification/economic-regression.txt) · [机器可读报告](VERIFICATION.json)
