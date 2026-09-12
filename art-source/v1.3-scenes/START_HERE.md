# v1.3 工厂直售区场景美术

先查看 `art-source/v1.3-scenes/qa/scene-overview.png`，其中展示首单、混合配货与成交三种场景设计。

- 新增三张独立 PNG：`art-source/v1.3-scenes/exports/`
- 单张资源总览：`art-source/v1.3-scenes/qa/contact-sheet.png`
- 制作说明、尺寸和图层：`art-source/v1.3-scenes/README.md`
- 浏览器预览页：`art-source/v1.3-scenes/index.html`
- 原图、完整提示词和生成记录：同目录 `sources/`、`prompts/`、`provenance-*.json`

解压后保留 `art-source` 目录结构，9 项复用精灵已经随包带入原相对路径。目录中的 Node 脚本用于确定性导出或本机预览；只看 PNG 不需要安装依赖。

全部生成使用内置 ImageGen。本包提供场景美术设计与独立预览。
