# TutorFlow 智能交互式教学助手

TutorFlow 是 DeepSeek Harness（DSH）的教学插件。它不另接模型，也不把对话转发出去。装上之后，DSH 里已经配置好的模型会按「一个知识点、一个问题」的节奏教学生：先看基础，再讲一点，主动提问，根据回答换讲法，并用本地 SVG 画数学图。

它不是聊天网页，也不是浏览器扩展。安装入口是 `dsh plugin add`。

## 能做什么

- 五种模式：循序渐进、考题攻坚、查漏补缺、快速讲解、自主探索。对话里说「换成查漏补缺」就会换。
- 考题三级提示：轻提示、思路提示、关键公式。只有学生明确要求时才给完整解答。
- 本地图形：函数、正态密度、分布函数、积分区域、坐标、知识结构、流程图。不加载境外脚本。
- 学习进度写在本机 `$DSH_HOME/dsh-tutorflow/state.json`。换一个新会话仍然能读到科目、章节、掌握度和错题。
- Web 会话标题栏有一个「教学」按钮，可在本地重画正态分布并缩放。按钮只在 DSH 页面里出现。

## 环境

- DSH `>=0.2.0 <0.3.0`（含 `0.2.2-rc.5` 这类预发布版本）
- Node.js 22.19+。DSH 0.2.2 命令行本身要求 Node 24+
- 不需要 OpenAI、Google 或额外的付费 API

## 安装

```sh
dsh plugin --profile web add dsh-tutorflow
```

包还没有发布到 npm 时，用本地目录或 Git 地址：

```sh
dsh plugin --profile web add /path/to/dsh-tutorflow
dsh plugin --profile web add github:Z06528/dsh-tutorflow
```

桌面版不要对 `desktop` 这个 profile 名使用命令行安装，改在应用里的插件页面安装。装完后重启这个 profile。

## 卸载

```sh
dsh plugin --profile web remove dsh-tutorflow
```

这会去掉依赖和 bundle 层。学习记录还在 `$DSH_HOME/dsh-tutorflow/`。要连记录一起删，退出 DSH 后删除该目录，或在对话里说「清除学习记录」。

卸掉之后，TutorFlow 的六个工具和系统提示段会随插件一起注销，DSH 自己的工具不受影响。

## 怎么用

在对话里直接说：

- 「我不理解概率密度函数。」
- 「换成考题攻坚。」然后贴题目。
- 「给我一个轻提示。」「看关键公式。」「我要完整解答。」
- 「画一张标准正态曲线，并把 −1 到 1 涂上。」
- 「查看学习进度。」「导出学习记录。」「清除学习记录。」

模型应先调用 `tutorflow_start`、`tutorflow_answer`、`tutorflow_hint`、`tutorflow_plot`、`tutorflow_mode`、`tutorflow_progress` 之一，再按工具返回的那一句话和一个问题往下教。

## 工具

| 工具 | 作用 |
| --- | --- |
| `tutorflow_start` | 判断主题或题目，进入一种模式，只提出第一个问题 |
| `tutorflow_answer` | 分析回答。错了就换讲法；对了才进入下一步 |
| `tutorflow_hint` | `light` / `idea` / `formula` / `solution` |
| `tutorflow_plot` | 本地 SVG |
| `tutorflow_mode` | 切换五种模式 |
| `tutorflow_progress` | 查看、导出、清除进度 |

## 开发

```sh
cd dsh-tutorflow
node --test test/tutorflow.test.mjs
npm pack
```

包声明了 `dsh.bundle`，补丁文件是 `cordis.patch.yml`，浏览器入口是 `client.browser.js`。

## 市场

正式收录取决于 npm 发布和目录维护者合并。本仓库的 `market/index.json` 是一份格式 1 的索引，可以在 DSH「插件 → 发现 → 添加索引源」里临时使用，这不等于已经被公共市场收录。

## 许可

MIT
