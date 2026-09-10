# 六代美术画廊

打开 `index.html` 浏览 24 件新增部件和 24 张全屏静态美术预览。部件图片引用 `../../integration/exports/` 中最终候选版本；点击资源可查看原尺寸源图与下载导出 PNG。画廊、筛选和弹窗只服务本地美术交付，不接正式游戏。

- `contact-sheet.png`：24 件新资源总览，标签单独排版。
- `asset-review.json`：逐包 PNG、尺寸、alpha、SHA、sourceFile、provenance 键、导出配方、提示词覆盖与最终 central 版本的双重只读审计。
- `gallery-verification.json`：本地相对链接、预览证据文件和内联 JavaScript 语法检查。
- `gallery-data.json`：可复用索引。

最终 24 件 palette PNG 已在总览中人工目检：轮廓、统一配色、边缘和小部件可读性可接受。六包原图/原始导出及其来源保持不变。

Chrome 浏览器自动检查被 Browser URL 安全策略拒绝（禁止访问本地 `file://`），未尝试间接导航、本地服务器或其他浏览器绕过。因此交互、响应布局和实际浏览器渲染标为 **NOT_RUN_URL_SECURITY_POLICY**；静态链接与脚本检查不能替代它们。

生成脚本仅允许写 `reports/gallery/`。使用 bundled Node 包目录作为 `NODE_PATH`，执行 `node art-source/six-gen/reports/gallery/build-gallery.cjs`。人工目检后执行 `node art-source/six-gen/reports/gallery/verify-gallery.cjs` 保存验证记录。
