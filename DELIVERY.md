# TutorFlow 交付说明

给下一个接手的人。下面每条都按这次实际跑过的结果写，没有把「准备提交」写成「已经收录」。

## 这是什么

`dsh-tutorflow` 0.1.0，DeepSeek Harness 0.2.x 的宿主插件。中文名：智能交互式教学助手。

它不调用自己的模型。宿主里已经配置的模型，必须先走六个 `tutorflow_*` 工具，再按工具返回的「一句讲解 + 一个问题」说话。进度写在 `$DSH_HOME/dsh-tutorflow/state.json`（可用 `TUTORFLOW_HOME` 改目录），原子改名写入。图形是本地 SVG，只有 `xmlns="http://www.w3.org/2000/svg"`，没有境外脚本。

工作区里的网页只是同一套 `lib/engine.js` 的验收台，不是另一款聊天产品。装进 DSH 才是正身。

## 对照过的宿主

- CLI：`@deepseek-ai/dsh` **0.2.2-rc.5**
- 引擎范围写成 `>=0.2.0-0 <0.3.0-0`。不要写成 `>=0.2.0 <0.3.0`，那样配不上 `0.2.2-rc.5` 这种预发布版本。
- 沙箱系统 Node 是 22。DSH CLI 要求 Node `>=24.9`。这次用的是 Node **24.11.0**。
- `inject` 必须是字符串数组。对象形式会让整个 harness 起不来。
- 工具用 `ctx.tools.register` 的原始定义，不用 `defineTool`，这样插件本身不 import `@deepseek-ai/*`。`output.schema` 和 `parameters` 都过了 `assertSupportedJsonSchema`。
- `isConcurrencySafe` 恒为 false，因为六个工具共用一份状态文件。
- Web 客户端不消费 `presentCall`。图同时放在工具结果的文字里（markdown data URI）和标题栏「教学」按钮的浮层里。浮层用 `react-dom` 的 `createPortal` 挂到 `document.body`，避免标题栏 `overflow` 裁切。
- 客户端插槽：`conversation.session.header.actions`，写法与 0.2.2 文档里的 `ctx.slots.inject` + `ctx.slots.register` 一致。
- 技能名 `tutorflow` 符合 `^[a-z0-9]+(?:-[a-z0-9]+)*$`。

## 文件

| 路径 | 作用 |
| --- | --- |
| `cordis.patch.yml` | `dsh.bundle` 补丁，插入 `id: tutorflow` / `name: dsh-tutorflow`。`id` 必须等于 `index.js` 的 `export const name` |
| `index.js` | `apply(ctx)`，注册工具、系统提示段、运行时技能 |
| `lib/engine.js` | 纯函数 `dispatch(state, action)` |
| `lib/curriculum.js` | 连续型随机变量五步课、拉普拉斯考题、五种模式 |
| `lib/charts.js` | 本地 SVG。标题做了 `& < > "` 转义 |
| `lib/expr.js` | 安全表达式，无 `eval` |
| `lib/store.js` | 原子写、按 mtime 重读 |
| `lib/prompt.js` | 系统提示段和 `SKILL.md` |
| `client.browser.js` | `window.__ModuleLoader__.load`，id 为包名 `dsh-tutorflow` |
| `test/tutorflow.test.mjs` | 八项验收，`node --test` |
| `market/index.json` | 格式 1 索引，已用 `@deepseek-ai/dsh-plugin-market-index` 的 `parseMarketIndex` 校验 |
| `market/awesome-dsh-plugin.yml` | 准备交给 awesome-dsh-plugin 的那一个文件 |
| `market/pr-body.md` | 对应 PR 说明。仓库未满 1 天，不要当天提 |

## 安装与卸载

npm **没有**发布。公开仓库已经可以安装：

```sh
dsh plugin --profile web add github:Z06528/dsh-tutorflow
```

本地目录（这次实际成功过）：

```sh
dsh plugin --profile web add /path/to/dsh-tutorflow
```

卸载：

```sh
dsh plugin --profile web remove dsh-tutorflow
```

桌面版不要对名为 `desktop` 的 profile 用命令行安装，改在应用里的插件页装。装完重启该 profile。

进度文件默认：`$DSH_HOME/dsh-tutorflow/state.json`。卸载插件不会删它。

## 这次实际跑过的测试

DSH 0.2.2-rc.5，Node 24.11.0，pnpm 10.18.0。自定义 profile 名 `tutorflow`，底下是 `@deepseek-ai/dsh-base` 加本插件。

| 项 | 结果 |
| --- | --- |
| `node --test test/tutorflow.test.mjs` | 8/8 通过 |
| `dsh plugin add` 本地目录 | 成功，`package.json` 的 bundles 含 `dsh-tutorflow`，`pnpm` 使用 `link:` |
| `dsh --dump-config` | 组合树末尾有 `- id: tutorflow` / `name: dsh-tutorflow`，同时仍有 `tools`、`agent` |
| 真实 Cordis：`SystemPrompt` + `SkillRegistry` + `ToolsService` + `apply` | 插件 fiber 为 ACTIVE。六个工具都注册上。六个 schema 都通过 `assertSupportedJsonSchema`。`tutorflow_start({topic:'概率密度函数'})` 的问题原文是「连续型随机变量和离散型随机变量最大的区别是什么？」。系统提示段和技能 `tutorflow` 都在 |
| 卸下再看 dump-config | `id: tutorflow` 消失，`id: tools` 和 `id: agent` 仍在。随后重新 add，行又回来 |
| 源码扫描 | 无 openai / googleapis / jsDelivr / unpkg / gstatic / cdnjs。绘图不调用 `fetch` |
| `npm pack` | 打出 `dsh-tutorflow-0.1.0.tgz` |
| `npm whoami` / `npm publish` | **失败**，`ENEEDAUTH`。没有 npm 登录，不能代发 |
| GitHub 公开仓库 | **已推送**。[Z06528/dsh-tutorflow](https://github.com/Z06528/dsh-tutorflow)，`main` 为 `088323f3c274061a222ff111f54a9ef0ce6db86e`。主题 `dsh-plugin`、`deepseek-harness`、`teaching` 已设置。安装钉住的提交仍是 `55e9a0e9df254fdd00b90d1ae5b0026b700d9fb5`，该提交在远程存在 |
| awesome-dsh-plugin 收录 | **已提交，未合并**。[PR #16963](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/16963)，只加了 `data/plugins/Z06528__dsh-tutorflow.yml`。仓库创建于 2026-11-19 12:32 UTC，不满 1 天，年龄检查会先失败，并在约 2026-11-20 12:32 UTC 后自行重跑。不要为了这一项关了重开 |
| 格式 1 索引校验 | 通过。安装 spec 为 `git+https://github.com/Z06528/dsh-tutorflow.git#55e9a0e9df254fdd00b90d1ae5b0026b700d9fb5`。仓库已经推上去，这个地址现在可以用来安装 |

教学八项里，引擎单测覆盖了 1–6 和 8。第 7 项在真实 profile 上做了「卸掉之后基础插件还在」的 dump，没有把整套 Web 客户端拉起来对一下标题栏按钮（那需要可用的模型配置和完整 web 进程）。隔离宿主里直接 `systemPrompt.assemble()` 会因没有 tool executor 抛 `TOOL_EXECUTOR_UNAVAILABLE`，这是测试夹具缺 executor，不是插件注册失败。

验收台网页（同一引擎）点过：开始这一问出现规定的第一个问题；典型错答出现「先不要推进」和错误定位；拉普拉斯考题进入考题攻坚且页面上没有 `0.632`。

## 下一个 agent 要做的事

1. 不要重开 [PR #16963](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/16963)。年龄检查大约在 2026-11-20 12:32 UTC 后自己变绿。若到那时仍红，看检查原文，不要改描述去绕过。
2. 合并之前，维护者还会对照源码核对那一句描述。六个工具名是 `tutorflow_start`、`tutorflow_answer`、`tutorflow_hint`、`tutorflow_plot`、`tutorflow_mode`、`tutorflow_progress`。
3. `npm login` 之后再 `npm publish --access public`。发布前再跑一次 `node --test`。名字 `dsh-tutorflow` 在动手时曾是 404，发布前再 `npm view dsh-tutorflow` 确认没被占用。
4. 不要把「PR 已打开」说成「市场已经收录」。官方 Discover 默认不带任何索引，用户要自己添加索引 URL。`market/index.json` 可以当一份自建源：`https://github.com/Z06528/dsh-tutorflow/raw/main/market/index.json`。

已完成、不要再做的事：公开仓库、`dsh-plugin` 主题、收录 PR。远程是 `https://github.com/Z06528/dsh-tutorflow.git`。

## 不要改回去的坑

- 回答判定先看误解句式，再看关键词。`每个点概率更大` 必须判错并且不增加 `stepIndex`。
- `我不理解概率密度函数` 不能被当成考题。`looksLikeProblem` 要求有「求 / 证明 / 设随机变量 / 概率密度函数为 / f(x)=」且足够长。
- 一次只允许一个 `？`。系统提示和工具文案都写了。
- 拉普拉斯的 `0.632` 只允许出现在 `solution` 的 `revealText`。轻提示、思路、公式里不能有。
- 图形样式「图形」才会在答错时附上定性图。不要在第一问就画出完整密度公式。
- 提示段 `interpolate: false`，避免学生原话被当成模板变量。
