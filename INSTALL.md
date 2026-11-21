# 安装与卸载

## 安装前

1. 装好 DeepSeek Harness 0.2.x，确认 `dsh --version` 能运行。
2. 确认你平时用的 profile 名字。Web 默认常常是 `web`，桌面版是 `desktop`。
3. 不需要再申请 OpenAI 或 Google 的密钥。教学使用这个 profile 里已经接好的模型。

## 安装

已发布到 npm（latest 为 **0.2.1**）：

```sh
dsh plugin --profile web add dsh-tutorflow
```

包页面：<https://www.npmjs.com/package/dsh-tutorflow>。
同一个包名下还有一个 `0.0.0-stage`，那是发布流程用的占位包，**不要拿它当安装版本**。

想装本地改动、或只有源码时，用目录：

```sh
dsh plugin --profile web add ./dsh-tutorflow
```

`github:Z06528/dsh-tutorflow` 这种写法需要本机能调用 `git` 并访问 github.com；
满足就用，不满足用上面的 npm 或本地目录即可。

桌面版：在应用里的**插件**页面点「添加插件」，选本地目录，不要对名为 `desktop` 的 profile 用命令行安装。

安装器会把包记入该 profile 的 `dsh.profile.bundles`，并应用 `cordis.patch.yml` 里的 `tutorflow` 行。完成后重启 profile。

## 怎么确认装上了

1. 重启该 profile。
2. **插件**页面里能看到 `dsh-tutorflow`，标题与描述是中文（或英文界面下的英文），有图标。
3. Web 会话标题栏出现「教学」按钮。
4. 开一个新会话，随便问一个没预设过的知识点，例如「为什么天空是蓝色的？」。
   正常表现是：老师先问你一句现状，而不是直接给你一段科普；答完之后只问一个问题；
   你答错了会换一种讲法，而不是把刚才的话再说一遍。

`dsh plugin --profile web list` 里也应当有 `dsh-tutorflow`。

## 卸载

```sh
dsh plugin --profile web remove dsh-tutorflow
```

重启 profile。标题栏的「教学」按钮、七个 `tutorflow_*` 工具和系统提示段会一起消失。
原有的文件、终端、模型配置不会被这个插件改写，卸载后应保持原样。

学习记录默认留在：

```text
$DSH_HOME/dsh-tutorflow/state.json
```

`$DSH_HOME` 未设置时，一般是用户主目录下的 `.dsh`。删除整个 `dsh-tutorflow` 目录即可清除记录，
也可以在卸载前对老师说「清除学习记录」。

## 常见问题

**启动报「plugin tree failed to load」**
先把插件 `remove` 掉，再把报错交给维护者。不要在坏掉的 profile 上继续叠加别的补丁。

**从 Git 安装时提示允许构建脚本**
这个包提交了现成的 `client.browser.js`，正常不需要 `prepare`。若安装器仍然询问，
在该 profile 的 `pnpm-workspace.yaml` 里允许这个包后再执行一次 `add`。

**改了插件代码但行为没变**
宿主插件换代码必须**重启该 profile**。链路安装（本地目录）会把文件立刻更新，
但运行中的 Host 仍持有上一次加载的模块。

**标题栏没有「教学」按钮**
确认装的是 web 客户端所需的 profile，并已重启。按钮只在 DSH 的 Web 页面里出现，
不影响教学本身——`tutorflow_*` 工具与系统提示段是独立的。

**老师又开始一次讲完**
先在对话里说「换成系统学习」，或让模型调用 `tutorflow_mode`。如果仍然一次讲完，
说明当前模型没有遵守系统提示段，可以在设置里把能力档设为 `small`，让插件承担更多判断。

**想换个说法重新开始同一个话题**
直接说「换个说法」或「从头讲」，插件会换一种表征或重建路线，不会重复上一轮的话。
