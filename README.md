# Fund Agent · 个人基金决策教练

个人基金工具：保留 Python 命令行诊断与规则引擎，并新增 [观基网页监测台](web-dashboard/README.md)。网页提供大盘、资金流向、基金/个股自选、VIX和持仓监测。当前未接入大语言模型对话。

网页入口：**[观基 · GitHub Pages](https://tenltrist.github.io/fund-agent/)**。源码：[tenltrist/fund-agent](https://github.com/tenltrist/fund-agent)。网页由 GitHub Actions 发布，不依赖 Sites。

## 直接运行

首次克隆先创建环境和本地配置：

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp data/portfolio.example.json data/portfolio.json
.venv/bin/python cli.py init-rules
```

本机已有环境和配置可直接运行：

```bash
cd "/Users/trist/Documents/ChatGPT/个人基金agent"
.venv/bin/python cli.py diagnose
.venv/bin/python cli.py market
.venv/bin/python cli.py list-rules
.venv/bin/python cli.py check-rules
```

也可以先执行 `source .venv/bin/activate`，之后使用 `python cli.py ...`。

| 命令 | 当前功能 | 联网 |
| --- | --- | --- |
| `diagnose` | 总资产与盈亏、行业占比、按行业标签识别可能重叠、前 1/3/5 只集中度、HHI、风险提示、碎片仓位 | 否 |
| `list-rules` | 列出已保存的规则及阈值 | 否 |
| `check-rules` | 保存持仓收益峰值并检查止损、行业集中度和定期复盘；历史不足的规则显示待补数据 | 否 |
| `init-rules` | 没有规则时创建 6 条默认规则；已有规则时仅列出 | 否 |
| `market` | 主要指数、持仓基金估算或已公布净值、行业资金流向、关注板块、半导体/贵金属连涨连跌、基金涨跌榜 | 是 |
| 不带子命令 | 持仓诊断，再检查现有规则 | 否 |

## 配置

- `data/portfolio.json`：本机个人持仓，已从后续版本的 Git 跟踪中移除。首次克隆复制 `data/portfolio.example.json` 后填写自己的数据；示例数值是虚构的。历史提交不在这次迁移中改写。
- `data/rules.json`：本机风控规则，不再跟踪。首次运行 `init-rules` 生成默认规则，本机已有规则保持原样。
- 持仓需手动维护；`market` 只查询并展示数据，不会更新 JSON 中的持仓金额和盈亏。
- `data/peak_state.json`：运行规则检查时自动创建，保存各持仓的已观察高点、成本和快照日期；已加入 `.gitignore`。保留此文件以便跨次运行持续跟踪。
- 网页界面位于 `web-dashboard/`，本地执行 `npm run dev` 后打开 `http://127.0.0.1:8765`。网页的个人数据保存在浏览器，与 Python 快照/峰值暂不自动同步。两端均不需要大模型 API Key。

## 基金数据补全

每只基金先使用当天的有效盘中估算，缺失、无效或过期的估算再由已公布净值补齐。估算已覆盖的基金不会被旧净值替换；某个接口失败时，保留另一个接口已取得的数据并显示失败原因。净值为零、缺少日期、非有限数值或未来日期的数据不计入覆盖。

每行显示实际日期和来源，汇总展示覆盖率及两类数据的数量。即使 13 只均有数据，只要日期不全是当天，也不会把混合日期的涨跌率算成组合今日收益。

## 高点止损的使用

`check-rules` 读取持仓快照中的累计 `profit_rate`，记录峰值后再比较回撤。`market` 返回的单日涨跌率不会被当作持仓累计收益率，也不会自动写入止损快照。

在 `data/portfolio.json` 顶层填写真实快照日期 `as_of`；在持仓中可以提供已知历史最高收益率 `peak_rate`。以下只是字段示例，数值不代表真实持仓：

```json
{
  "as_of": "2026-11-16",
  "holdings": [
    {
      "name": "示例基金",
      "code": "000001",
      "amount": 1350,
      "sector": "其他",
      "cost_basis": 1000,
      "profit": 350,
      "profit_rate": 35,
      "peak_rate": 50,
      "position_id": "持仓周期1"
    }
  ]
}
```

- 收益率字段用百分数，例如 `50` 表示 `+50%`。不知道历史高点时省略 `peak_rate`；首次仅建立基线并显示“待补数据”。重复检查同一份快照不会伪造更多历史。
- 后续更新真实快照，再运行 `check-rules`，峰值会跨运行保存、新高时上调、下跌时保留。较旧快照以及替代已带日期记录的无日期快照，不会覆盖现有高点。
- 回撤按高点价值计算：`(峰值收益率 - 当前收益率) / (100 + 峰值收益率) × 100%`。例如峰值 `+50%`、当前 `+35%`，价值从 `1.50` 降至 `1.35`，回撤是 `10%`，不是 15 个百分点。现有止损阈值数值保持原样。
- 成本变化、持仓批次变化或观察到移除后重新持有时，重新建立可比较的峰值。未填写 `cost_basis` 时尝试用“金额减盈亏”识别成本；清仓后重买应更新 `position_id`。同一份旧 `peak_rate` 不会在重置后自动带入新持仓。
- 本机原始持仓没有历史快照和真实持仓日期，无法追溯第一次记录之前的真实最高点。现有 4 条止损在没有补充高点或后续真实观察前会显示“待补数据”，不会误报全部通过。记录时间与快照日期分开保存，旧持仓不会被标成今天的持仓。

## 本机验证（2026-11-16）

环境：Python 3.12.13、AKShare 1.20.65、pandas 3.1.1、NumPy 2.5.5；依赖兼容性检查通过。

- 帮助、持仓诊断、规则列表、规则检查、默认入口和规则初始化均正常退出。会写规则的验证在临时数据副本上运行，原有持仓和规则文件保持原样。
- `market` 已实际联网运行并正常退出，取得指数、基金数据、行业资金流向、板块历史数据和基金涨跌榜。接口可用性反映本次运行，后续仍取决于数据源。
- 基金数据补全已实测 **13/13 只**：2 只当天估算、11 只已公布净值；日期分别来自 2026-11-16 和 2026-11-12/13，全部保留来源与日期。
- 38 项离线回归测试通过，覆盖双源补全与故障保留、异常数值和日期、行情展示，以及峰值跨进程保存、新高更新、回撤阈值、成本/批次变化、清仓重买、旧快照拒绝和首次数据不足。
- 用原有 13 条持仓的临时副本验证了规则检查：正确创建 13 条峰值基线，4 条历史不足的止损保持待补数据；重复同一快照不会当作新的历史。原持仓和规则配置未改写。

```bash
.venv/bin/python -m unittest discover -s tests -v
uv pip check --python .venv/bin/python
```

运行日志保存在忽略版本控制的 `.venv/verification/`，其中 `fund-coverage.json` 是双源补全的联网核查结果，`market-complete.log` 是补全后的市场命令输出，`check-rules-tracked.log` 是原持仓副本的峰值检查输出。

上述修复、测试与说明保留在本地，尚未推送到 GitHub。

## 尚未完成的部分

- **风险和重叠判断**：行业依赖手动标签；重叠分析没有穿透基金重仓股。最大回撤的 15%/25% 来自固定启发式规则，并非历史回测。
- **规则细节**：“每周复盘（周五）”实际按距离上次触发的天数检查，不限定星期五；最低仓位类型虽已声明，尚未接入检查流程。
- **关注板块**：两组同名 `MY_SECTORS` 常量发生覆盖，行业名称与概念名称也未统一，关注板块筛选可能漏项。未被 CLI 调用的概念板块辅助函数还引用了未定义函数。

## 重建环境

已安装 `uv` 时，在项目目录执行：

```bash
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r requirements.txt
```

`requirements.txt` 当前使用版本下限，没有锁定全部依赖版本。
