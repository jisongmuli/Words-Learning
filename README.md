# Words-Learning · 拾词

一个在本机运行的英语单词学习网站。词库、学习进度和生词本使用本地 JSON 文件保存，学习和 PDF 导出无需联网。

## 功能

- 四级、六级、考研词汇及各自的核心词汇，共六本词汇书。
- 一本常用短语书，包含 188 个常见表达。
- 每轮默认 10 词，可自行设置 1–100 词，并选择按顺序或随机刷未学词。
- 先勾选不认识的词，再查看本轮全部中文释义，允许修正选择。
- 确认的陌生词汇总到生词本，跨词书自动合并，保留来源。
- 保存每本词书的进度、当前轮和勾选，重开后继续学习。
- 词书和生词本均可导出 A4 PDF：左侧英文、右侧中文，自动分页并重复表头。

## 开始使用

主要面向 Windows。安装 Python 3.10 或更新版本，然后运行：

```powershell
git clone https://github.com/jisongmuli/Words-Learning.git
cd Words-Learning/word-study
python -m pip install -r requirements.txt
python server.py
```

在浏览器打开 **http://127.0.0.1:8765**。

也可以双击 `word-study/Launch.cmd`，启动器会打开浏览器，并在已有服务运行时直接复用。双击 `word-study/Stop.cmd` 停止服务。启动器依次尝试 `WORD_STUDY_PYTHON` 环境变量、Codex 内置 Python、系统 Python；所选环境需要安装 `reportlab`。

中文 PDF 默认使用 Windows 黑体 `C:/Windows/Fonts/simhei.ttf`。使用其他系统或字体时，设置环境变量 `WORD_STUDY_FONT` 指向含中文字形的 TTF 文件。

## 本地数据

| 路径 | 用途 |
|---|---|
| `word-study/data/books/` | 随项目提供的七本 JSON 词书 |
| `word-study/data/user/state.json` | 个人设置、学习进度和生词本，首次启动时自动生成 |
| `word-study/data/user/state.backup.json` | 上一次保存的学习数据 |
| `word-study/public/` | 页面、样式、交互和图标 |
| `word-study/server.py` | 本地服务、学习流程和 PDF 导出 |

个人学习数据、日志、测试下载和生成的 PDF 已加入 Git 忽略规则。下载或克隆仓库时不会附带个人进度。

## 词库

考试词汇来自 [ECDICT](https://github.com/skywind3000/ECDICT)，其 MIT 许可保留在 [`word-study/data/ECDICT-LICENSE.txt`](word-study/data/ECDICT-LICENSE.txt)。

| 词书 | 词条数 |
|---|---:|
| 四级词汇 | 3,846 |
| 六级词汇（含四级基础词） | 5,802 |
| 考研词汇 | 4,801 |
| 四级核心词汇 | 1,200 |
| 六级核心词汇 | 1,500 |
| 考研核心词汇 | 2,000 |
| 常用短语 | 188 |

核心词书是对应完整词书的子集，结合考试标签和公开语料库词频筛选，并优先选取非中高考基础词；它们不是历年真题频次榜。社区词库的考试标签不保证与当年官方大纲完全一致。

词库已随项目提供，日常运行不需要下载数据。需要重新整理时运行 `python tools/build_books.py`，该操作需要联网。

更详细的学习流程、备份恢复和运行方式见 [`word-study/README.md`](word-study/README.md)。

## 检查

在 `word-study` 目录执行：

```powershell
python tools/verify.py
```

检查使用独立的临时数据，覆盖进度恢复、自定义每轮词数、修正勾选、跨词书去重、生词复习、写入失败恢复及双语 PDF。生成的检查用 PDF 保存在忽略的 `output/pdf/` 目录中。
