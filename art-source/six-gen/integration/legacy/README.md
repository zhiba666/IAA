# 当前构建使用的复用装配

这两份 JSON 是当前六代游戏构建的必需源数据，保留首代机器、缓冲仓、包装与输送带的原始装配坐标。

| 活动文件 | 原始来源 |
| --- | --- |
| `batch-0-assembly.json` | `art-source/batch-0/assembly.json` |
| `batch-1-machinery-assembly.json` | `art-source/batch-1/machinery/assembly.json` |

文件从 `archive/pre-v0.1/` 中对应历史快照逐字节复制并核对 SHA-256，未改变装配内容。历史快照继续保留；正式构建只读取本活动目录，不依赖归档目录或临时工作树。运行 PNG 仍使用上一级 `exports/` 中的 84 张最终资源。

这些文件仍在使用，不应在清理历史资料时移走。修改后执行 `npm test`；构建回归会在没有 `archive/` 的临时目录中验证开发和正式两种构建。
