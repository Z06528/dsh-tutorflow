- [x] I added **one file** at `data/plugins/Z06528__dsh-tutorflow.yml` — that single file is the whole submission.
- [x] The plugin `package.json` declares **`dsh.bundle`** (`dsh.bundle.patch` → `./cordis.patch.yml`), a web `dsh.client`, and a `./icon` export.
- [x] The repository topic **`dsh-plugin`** is set.
- [x] `category: tools`
- [x] The description says what the plugin does, without superlatives.

Submission file (copy to `data/plugins/Z06528__dsh-tutorflow.yml`):

```yaml
url: https://github.com/Z06528/dsh-tutorflow
name: Z06528/dsh-tutorflow
category: tools
description:
  en: Gives the model a teaching method instead of a lecture: decide between a quick answer and real understanding, then teach one step and one question at a time, diagnose why a wrong answer is wrong, and draw local figures. Works for any subject, including topics with no preset course. Progress stays on disk.
  zh: 给模型一套会教书的方法：先判断你要快速答案还是想弄懂，再一步一步讲、一次只问一个问题，答错先分清错在哪一类，并用本地图形辅助。不限学科，没有预设课程的知识点同样适用。学习记录写在本机。
```

This file is the request body only. Opening or merging the pull request is a separate step and is not done by publishing the plugin repository.

已开启的 PR 正文写的是 0.1.0 的描述。README 里不再声称「已收录」；
本文件只是下一次提交时应该用的正文。
