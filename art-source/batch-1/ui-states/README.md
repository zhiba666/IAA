# 批次 1 · UI 装配与动效规范

- [独立装配页](index.html)：7 类界面、24 个状态样例，390×844 / 320×524 同时校对。
- [布局数据](spec/layout.json)：安全区、44×44 点击区、文字层、资源引用与逐稿状态。
- [状态覆盖](state-coverage.md)：U03、机器、库存、选择、生产限制与异常状态规定。
- [动效 JSON](motion-spec.json) / [动效说明](motion-spec.md)：F01 六组时间轨、触发与终止条件。
- [静态核查摘要](static-qa.json)：规则、扩建样例账面关系、PNG 来源及九宫格中心面积；使用 `node art-source/batch-1/ui-states/verify-static.cjs` 重建。

通过允许读取项目 `art-source/` 与 `assets/art/` 的本地静态服务打开。此页面只请求这两个目录内的资源，未加载游戏入口，也不读写存档。批次 0 的专用服务限制了路由，不能直接用于本目录。

Chrome QA 可遍历顶部 7 类及每类状态，在控制台读取 `window.artPreviewReport`。报告每次在当前引用图片加载完毕后刷新；`scrollHeight` 不应超过视口高度，`sceneHeight` 不应低于布局最小值，`undersizedButtons` 应为空。需另看九宫格伸缩、中文换行、透明边缘和暗色背景。

场景中的三台机体 PNG 是观察区位置示意，完整分层设备装配由 `../machinery/assembly.json` 管理。页面未冒充完整产线构图或游戏状态绑定。
