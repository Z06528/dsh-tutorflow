# 交付说明

给下一个接手的人。每条都按实际跑过的结果写；没跑过的会明确写成「未验证」。

## 这是什么

`dsh-tutorflow` 0.2.1，DeepSeek Harness 0.2.x 的宿主插件（bundle）。
定位已从「概率论教学插件」改为**通用教学增强**：它不教具体知识，它给模型一套会教书的方法。

不调自己的模型、不联网、不上传对话。教学用宿主里已配置的模型。
学习记录写在 `$DSH_HOME/dsh-tutorflow/state.json`（`TUTORFLOW_HOME` 可改目录），原子写入。
图形是本地 SVG，只有 `xmlns="http://www.w3.org/2000/svg"`。

## 0.2.x 相对 0.1.0 的关键变化

| 层 | 变化 |
| --- | --- |
| 分类 | 新增 `lib/taxonomy.js`：意图 / 知识类型 / 学科 / 复杂度 / 起点 |
| 路线 | 新增 `lib/plan.js`：通用骨架 + 模型自拟路线的形状校验 |
| 动作 | 新增 `lib/moves.js`：表征轮换、六类错误分型、追问框架、课堂姿态 |
| 记忆 | 新增 `lib/mastery.js`：证据、置信度、六档状态、间隔复习 |
| 内容 | `curriculum.js` 的内容迁进 `lib/packs/`，降为可选课程包 |
| 工具 | 新增 `tutorflow_plan`（共 7 个），其余参数扩展且向后兼容 |
| 图形 | 8 种 → 14 种（新增柱状、多曲线、表格、结构树、时间线、代码追踪） |
| 客户端 | 正态分布浮层 → 通用本地绘图台（可输入任意表达式） |
| 状态 | v1 → v2 自动迁移，旧掌握度与错题不丢 |
| 测试 | 8 项 → 36 项 |

## 文件

| 路径 | 作用 |
| --- | --- |
| `cordis.patch.yml` | `dsh.bundle` 补丁，插入 `id: tutorflow` / `name: dsh-tutorflow` |
| `index.js` | `apply(ctx)`：7 个工具 + 系统提示段 + 运行时技能 |
| `lib/engine.js` | 纯函数 `dispatch(state, action)` |
| `lib/taxonomy.js` | 问题分类（零课程） |
| `lib/plan.js` | 路线骨架与校验 |
| `lib/moves.js` | 教学动作、表征、错误分型 |
| `lib/mastery.js` | 掌握度与间隔复习 |
| `lib/packs/` | 可选课程包（连续型随机变量、拉普拉斯考题） |
| `lib/charts.js` | 14 种本地 SVG |
| `lib/expr.js` | 安全表达式（无 `eval`） |
| `lib/store.js` | 原子写、mtime 重读、v1→v2 迁移 |
| `lib/prompt.js` | 系统提示正文（无工具也能教） |
| `client.browser.js` | `window.__ModuleLoader__.load`，id 为包名 |
| `skills/tutorflow/SKILL.md` | 运行时技能正文 |
| `docs/ARCHITECTURE.md` | 审查结论与通用教学架构 |
| `docs/TEST-REPORT.md` | 跨学科测试报告、失败案例与修复 |
| `scripts/simulate.mjs` | 生成跨学科教学轨迹，供模型在环测试 |
| `test/tutorflow.test.mjs` | 36 项 |
| `icon.svg` / `locale/` | 插件市场展示元数据 |

## 验证状态

已验证（在本机 `desktop` profile 上真的装过并调用过）：

- `plugin_manager install_bundle` 指向本地目录 → `application: applied`，当时版本显示 0.2.0
  （同一份源码现在标为 0.2.1，内容未变）。
  profile 的 `dependencies` 与 `dsh.profile.bundles` 都出现 `dsh-tutorflow`。
- 装完后 7 个 `tutorflow_*` 工具与系统提示段**当场出现在运行中的会话里**，
  `tutorflow_start` 返回了正确的第一步指令，`tutorflow_answer` 与 `tutorflow_progress` 也能用。
- 状态文件写到了 `$DSH_HOME/dsh-tutorflow/state.json`，内容是 v2（含 4 步路线、`focus.lastAsk`、
  `history`），系统提示段随之更新（阶段从 `idle` 变 `diagnose`）。
- `node --test test/tutorflow.test.mjs` → **36/36 通过**。
- 七个工具的参数与输出 schema 在本地按 DSH 0.2.x 的受支持子集逐节点校验通过。
- `npm pack --dry-run` → 29 个文件、94 kB，`icon.svg`、`docs/`、`locale/`、`lib/`、`skills/` 都在包里。
- 全部 `.js` / `.mjs` 通过 `node --check`；全部 `.json` 通过解析。
- **已发布到 npm**：`dsh-tutorflow`，latest 为 **0.2.1**，0.2.0 也是正式包。
  两个版本的 `gitHead` 都是 `08ead91`、`fileCount` 与 `unpackedSize` 完全相同，
  也就是说**内容一致，0.2.1 只是版本号对齐**。页面：
  <https://www.npmjs.com/package/dsh-tutorflow>。
  同一个包名下还有一个 `0.0.0-stage`，那只是两步发布用的占位包（2 个文件、`stub: true`），**不要拿它当安装版本**。
- GitHub 已推送，`main` 上 `package.json` 的 `version` 为 `0.2.1`。

未验证 / 需要重启：

- **宿主插件换代码必须重启 profile 才生效**。这次把修复同步进已安装副本后，运行中的 Host
  仍持有旧模块（工具返回的还是旧文案）。所以「最后一次修复后的行为」只在单测里验过，
  没有在运行中的 profile 上复验。重启后请按 `INSTALL.md` 的清单再走一遍。
- **客户端「教学」按钮没有在浏览器里目视确认过**。`client.browser.js` 只用 `node --check` 验过语法，
  插槽名与 0.1.0 相同，改的是面板内容。

## 安装与卸载

正常路径是 npm：

```sh
dsh plugin --profile web add dsh-tutorflow
dsh plugin --profile web remove dsh-tutorflow
```

本地目录或 ZIP 解压后也可以：

```sh
dsh plugin --profile web add /path/to/dsh-tutorflow
```

从 GitHub 直接装需要这台机器能调用 `git` 并且能访问 github.com；本机这两条不具备，
所以 `github:` 那个写法在这里不适配，也不必再排。npm 已经可用，直接用上面的包名安装即可。

桌面版在应用里的**插件**页面安装，不要对 `desktop` profile 用命令行。

## 下一个接手的人可以做的

1. 重启 profile 后按 `INSTALL.md` 的检查清单确认 7 个工具、系统提示段、技能、图标都在。
2. 真人试用：找 3–5 个不同学科的真人各问 3 个问题，记录「有没有被当成课堂」「有没有一次讲完」
   「答错时有没有被说清错在哪」。这是唯一能替代模型打分的东西。
3. 发新版：先 `node --test`，再 `npm version patch`、`npm publish --access public`。
   发布凭据只放在本机 npm 配置里，**不要写进仓库**；用过的令牌发完即作废，不要提交到任何文件。
4. `market/index.json` 里的 `versions[].source.commit` 指向发版那次提交。
   每次发新提交后要同步更新，否则自建索引会装到旧版本。
5. 社区目录收录申请已经合并，**不要重开**。

## 不要改回去的坑

- **一次只问一个问题**：`normalizeQuestion` 保证句末只有一个问号；工具返回里只有一个 `ask`。
- **绝不默认答对**：模型不给 `verdict` 时只做保守推断（不知道→unclear，带问号→unclear，其余→partial）。
- **课程包的误区句式优先于模型判定**，但只对课程包自己的步骤生效。
- **内部脚手架不得外泄**：`facingConcept()` 负责把 `track: false` 的步骤换成话题名。
  改 `plan.js` 的骨架标签时不用管这一点，但不要在别处再把 `step.label` 直接拼进学生话术。
- **换讲法必须真的换**：`narrow` 与 `reteach` 用 `nextRepresentation`；`verify` 沿用表征但换例子。
- **同一个点问满六轮必须收束**（`unsettled`），不能无限换说法。
- **学生反问走 `answer-back`**，不能当答错去纠正。
- **状态 v1→v2 迁移**在 `store.normalize()` 里，旧字段 `mastery[].attempts` 要映射到 `evidence`。
- 回答判定先看误解句式，再看模型判定，最后才是启发式兜底。顺序不要颠倒。
