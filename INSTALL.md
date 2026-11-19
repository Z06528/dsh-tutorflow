# 安装与卸载

## 安装前

1. 安装 DeepSeek Harness 0.2.x，并确认 `dsh --version` 能运行。
2. 确认你平时用的 profile 名字。Web 默认常常是 `web`。
3. 不需要再申请 OpenAI 或 Google 的密钥。教学使用这个 profile 里已经接好的模型。

## 安装

npm 已发布时：

```sh
dsh plugin --profile web add dsh-tutorflow
```

只有源码时：

```sh
dsh plugin --profile web add github:Z06528/dsh-tutorflow
```

本地目录：

```sh
dsh plugin --profile web add ./dsh-tutorflow
```

安装器会把包记入该 profile 的 `dsh.profile.bundles`，并应用 `cordis.patch.yml` 里的 `tutorflow` 行。完成后重启 profile。

Web 界面里，会话标题旁应出现「教学」。对话里说「我不理解概率密度函数」，老师应先问离散和连续的差别，而不是直接写密度公式。

若从 Git 安装时提示需要允许构建脚本：这个包提交了现成的 `client.browser.js`，正常不需要 `prepare`。若安装器仍然询问，在 profile 的 `pnpm-workspace.yaml` 里允许该包后再执行一次 `add`。

## 卸载

```sh
dsh plugin --profile web remove dsh-tutorflow
```

重启 profile。标题栏的「教学」按钮和六个 `tutorflow_*` 工具会消失。原有的文件、终端、模型配置不会被这个插件改写，卸载后应保持原样。

学习记录默认留在：

```text
$DSH_HOME/dsh-tutorflow/state.json
```

`$DSH_HOME` 未设置时，一般是用户主目录下的 `.dsh`。删除整个 `dsh-tutorflow` 目录即可清除记录。也可以在卸载前对老师说「清除学习记录」。

## 确认已经装上

```sh
dsh plugin --profile web list
```

列表中应有 `dsh-tutorflow`。若列表里没有，或启动报「plugin tree failed to load」，先 `remove` 再把报错交给维护者，不要继续往坏掉的 profile 上加别的补丁。
