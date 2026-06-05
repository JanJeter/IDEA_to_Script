# 使用说明

## 运行项目

```bash
npm install
cp .env.example .env
npm run dev
```

打开 `http://localhost:3000` 后即可使用。没有配置 `OPENAI_API_KEY` 时，系统会自动进入 mock 模式，适合本地演示和比赛答辩。

## 页面流程

1. 在左侧输入区粘贴 3 章以上小说，或点击「载入示例」。
2. 查看输入区下方的字数、章节数量和章节标题预览。
3. 点击「开始转换」，中间栏会展示章节解析、章节分析、人物/世界观汇总、分场生成、Schema 校验五步状态。
4. 转换完成后，在右侧复制、下载或重新校验 YAML 剧本。

## 前端提示

- 少于 3 章时，页面会直接提示继续补充内容。
- 复制 YAML 后按钮会短暂显示「已复制」。
- Schema 校验失败时，错误路径和说明会显示在 YAML 预览下方。
- 小屏幕会自动切换为单列布局，三块内容按输入、进度、输出顺序排列。

## 常用命令

```bash
npm test
npm run validate
npm run build
```

当前 PR 主要改动位于 `app/page.tsx`、`app/globals.css`、`README.md` 和 `use.md`。
