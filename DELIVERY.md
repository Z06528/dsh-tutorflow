# 交付说明

给下一个接手的人。每条都按实际跑过的结果写；没跑过的会明确写成「未验证」。

## 这是什么

`dsh-tutorflow` 0.2.0，DeepSeek Harness 0.2.x 的宿主插件（bundle）。
定位已从「概率论教学插件」改为**通用教学增强**：它不教具体知识，它给模型一套会教书的方法。

不调自己的模型、不联网、不上传对话。教学用宿主里已配置的模型。
学习记录写在 `$DSH_HOME/dsh-tutorflow/state.json`（`TUTORFLOW_HOME` 可改目录），原子写入。
图形是本地 SVG，只有 `xmlns="http://www.w3.org/2000/svg"`。

## 0.2.0 相对 0.1.0 的关键变化

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
| 测试 | 8 项 → 35 项 |

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
| `test/tutorflow.test.mjs` | 35 项 |
| `icon.svg` / `locale/` | 插件市场展示元数据 |

## 验证状态

已验证：

- `node --test test/tutorflow.test.mjs` → **35/35 通过**。
- 七个工具的参数与输出 schema 在本地按 DSH 0.2.x 的受支持子集逐节点校验通过
  （`type` 单值 / `oneOf` ≥2 / `properties` / `required` ⊆ `properties` / `additionalProperties` 布尔 / `items` / 标量 `enum`、`const` + 注解）。
- `npm pack --dry-run` → 29 个文件、94.4 kB，`icon.svg`、`docs/`、`locale/`、`lib/`、`skills/` 都在包里。
- 全部 `.js` / `.mjs` 通过 `node --check`；全部 `.json` 通过解析。
- 跨学科模型在环测试三轮，详见 `docs/TEST-REPORT.md`。

未验证：

- **没有在真实 profile 里装过这一次的构建**。0.1.0 曾在真实 DSH 0.2.2-rc.5 上装过并通过
  （fiber ACTIVE、六个工具注册、schema 全过），但 0.2.0 只做了本地 mock ctx 与 schema 子集校验。
  第一次真装时请按 `INSTALL.md` 的「怎么确认装上了」逐条对。
- **客户端「教学」按钮没有在浏览器里目视确认过**。`client.browser.js` 只用 `node --check` 验过语法，
  插槽名与 0.1.0 相同（`conversation.session.header.actions`），改的是面板内容。
- **没有发布到 npm**。`npm whoami` 无登录态。

## 安装与卸载

```sh
dsh plugin --profile web add github:Z06528/dsh-tutorflow
dsh plugin --profile web remove dsh-tutorflow
```

本地目录或 ZIP 解压后：

```sh
dsh plugin --profile web add /path/to/dsh-tutorflow
```

桌面版在应用里的**插件**页面安装，不要对 `desktop` profile 用命令行。

## 下一个接手的人可以做的

1. 在真实 profile 里装一次，按 `INSTALL.md` 的检查清单确认 7 个工具、系统提示段、技能、图标都在。
2. 真人试用：找 3–5 个不同学科的真人各问 3 个问题，记录「有没有被当成课堂」「有没有一次讲完」
   「答错时有没有被说清错在哪」。这是唯一能替代模型打分的东西。
3. 想发 npm 就先 `npm login`，再 `npm publish --access public`；发布前重跑 `node --test`。
4. `market/index.json` 里的 `versions[].source.commit` 指向当前 `main` 的提交。
   每次发新提交后要同步更新，否则自建索引会装到旧版本。
5. awesome-dsh-plugin 的 PR #16963 仍是 0.1.0 的描述。要不要重开一个 PR，问维护者。

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
