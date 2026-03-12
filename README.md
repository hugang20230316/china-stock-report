# china-stock-report

`china-stock-report` 是一个用于生成 A 股当日推荐 HTML 报告的 Codex skill。

它依赖 `china-stock-analysis` 先生成当天 raw output，再执行校验、补数、截图和 HTML 组装，最终输出 `stock_report_YYYYMMDD.html`。

## 仓库结构

```text
china-stock-report-publish/
├── README.md
└── skills/
    └── china-stock-report/
        ├── SKILL.md
        ├── agents/openai.yaml
        ├── config/report.config.json
        ├── scripts/
        └── references/
```

## 依赖

- Node.js
- Python 3
- Playwright
- 已安装并可运行的 `china-stock-analysis` skill

## 发布到 GitHub

推荐把整个仓库推到 GitHub，而不是只上传 skill 目录。

```powershell
cd C:\Users\58219\china-stock-report-publish
git init
git add .
git commit -m "Initial publish of china-stock-report skill"
git branch -M main
git remote add origin https://github.com/<你的用户名>/<你的仓库名>.git
git push -u origin main
```

## 别人如何安装

### 方式 1：通过 GitHub 子目录安装

如果对方环境支持官方 skill 安装脚本，可以从 GitHub 仓库里的 skill 子目录安装：

```bash
python <skill-installer>/scripts/install-skill-from-github.py \
  --url https://github.com/<你的用户名>/<你的仓库名>/tree/main/skills/china-stock-report
```

### 方式 2：手工安装

把仓库中的 `skills/china-stock-report` 整个目录复制到本机 skill 目录中：

- 新版文档路径通常是 `~/.agents/skills/`
- 你当前本机这套环境使用的是 `~/.codex/skills/`

## 环境变量

- `CHINA_STOCK_REPORT_ROOT`
  - 指向外部运行工作区
- `CHINA_STOCK_REPORT_CONFIG`
  - 指向自定义配置文件
- `STOCK_PLAYWRIGHT_PATH`
  - 指向可用的 Playwright 安装路径

## 快速测试

先校验 skill 结构：

```powershell
python -X utf8 C:\Users\58219\.codex\skills\.system\skill-creator\scripts\quick_validate.py `
  C:\Users\58219\china-stock-report-publish\skills\china-stock-report
```

再检查关键脚本语法：

```powershell
node --check C:\Users\58219\china-stock-report-publish\skills\china-stock-report\scripts\fetch_data.js
node --check C:\Users\58219\china-stock-report-publish\skills\china-stock-report\scripts\verify_raw.js
node --check C:\Users\58219\china-stock-report-publish\skills\china-stock-report\scripts\build_analysis_from_raw.js
node --check C:\Users\58219\china-stock-report-publish\skills\china-stock-report\scripts\screenshot.js
node --check C:\Users\58219\china-stock-report-publish\skills\china-stock-report\scripts\generate_report_html.js
```

## 生成测试

安装后，可用类似提示词触发：

```text
Use $china-stock-report to validate today's raw stock analysis input and generate stock_report_YYYYMMDD.html.
```

## 如果想进官方技能目录

可选路径是向 `openai/skills` 提交 PR。

建议顺序：

1. 先用你自己的 GitHub 仓库公开发布并自测安装链路
2. 再整理成 `openai/skills` 接受的目录结构
3. 先投 `.experimental`
4. 稳定后再考虑 `.curated`

提交前至少确认：

- `SKILL.md` frontmatter 合法
- `agents/openai.yaml` 可用
- 不依赖你私有机器上的写死路径
- 脚本和文档都能在公开环境下解释清楚依赖关系

## 当前发布建议

优先走 GitHub 自托管发布。这条路径最快，也最容易让别人先装起来测试。
