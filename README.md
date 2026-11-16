# Context Resilience Kit

让仓库在聊天压缩、线程交接、文档冲突、发布漂移和角色职责漂移后，仍能恢复到可验证的当前状态。

本工具不保存原始聊天，不自动部署，不自动修改业务状态。默认检查为只读；唯一的自动写入是显式执行 `--write` 时重建 `CONTEXT-RESUME.md`。

## English Abstract

Context Resilience Kit is a dependency-free Node.js toolkit and Codex skill for durable repository context. It separates current rules, append-only decisions, open work, release state, task evidence, and a generated recovery resume. It also binds coordinator roles to exact thread IDs and blocks dispatch-first violations, raw history scans, open-ended code exploration, debugging, implementation, and follow-on investigation by coordinators.

## 解决什么问题

- 压缩摘要丢掉用户决策、证据来源或撤销关系。
- 多份自然语言文档同时维护“当前事实”，产生漂移。
- 生产版本、manifest 和 `/version` 不一致却被当作已发布。
- 旧外部审核回执被重复使用。
- 代理建议被误记为用户决策。
- 手工编辑恢复摘要，污染新线程。
- 协调者把“不写代码”误解成可以亲自扫描历史、读长日志、调试或做完整调查。
- `dispatchSatisfied=true` 只靠布尔值自报，无法证明真的派过单。

## 核心结构

| 文件 | 职责 |
|---|---|
| `PROJECT-CONTEXT.md` | 稳定架构、目录、命令和环境边界 |
| `PRODUCT-CONTRACT.json` | 当前有效规则、决策绑定和机器探针 |
| `DECISION-LOG.jsonl` | 只追加的决策、来源和替代链 |
| `WORK-STATE.json` | 仅保存尚未关闭的任务 |
| `RELEASE-STATE.json` | 发布声明、证据和外部状态快照 |
| `ROLE-CONTRACT.json` | 精确线程绑定、角色动作白名单和验收预算 |
| `TASK-LOG.md` | 已发生任务及证据 |
| `CONTEXT-RESUME.md` | 由结构化来源生成的角色卡和恢复导航 |

权威顺序、开工/收工协议和失败条件见技能中的 `references/`。

## 安装

要求 Node.js 18.17 或更高版本，无第三方运行时依赖。

```bash
git clone <repository-url> context-resilience-kit
node context-resilience-kit/skill/context-resilience/scripts/context-resilience.js --help
```

作为 Codex skill 使用时，将以下目录放入 `$CODEX_HOME/skills/`：

```text
skill/context-resilience/
```

也可以直接按技能中的 `templates/` 将上下文文件接入任意仓库。

## 接入仓库

1. 将 `templates/.context-resilience.json` 复制到目标仓库根目录，并保持文件名为 `.context-resilience.json`。
2. 将其余模板复制到目标仓库的 `context/` 目录，文件名保持不变。
3. 替换模板中的合成线程 ID、规则、探针和证据路径。
4. 将真实协调者线程 ID 绑定到 `profiles.director`；不要根据标题推断角色。
5. 将当前未完成任务写入 `WORK-STATE.json`，未实时核验的发布状态写为 `unverified`。
6. 执行：

```bash
node <skill-dir>/scripts/context-resilience.js --root <repo> --write
node <skill-dir>/scripts/context-resilience.js --root <repo> --fast
node <skill-dir>/scripts/context-resilience.js --root <repo> --role
```

6. 在仓库指令文件中要求任务开始执行 `--fast`、绑定协调者执行 `--role`、发布前执行 `--release`。

## 命令

```bash
context-resilience --root <repo> --fast
context-resilience --root <repo> --deep
context-resilience --root <repo> --release
context-resilience --root <repo> --role
context-resilience --root <repo> --role --role-input <request.json>
context-resilience --root <repo> --write
```

- `--fast`：schema、引用、决策链、任务状态、发布主张、角色契约、恢复摘要和敏感信息。
- `--deep`：完整规则探针和候选扫描。
- `--release`：严格版本一致性、外部门时效、占位符和证据。
- `--role`：角色绑定与动作计划判定。
- `--write`：只重建 `CONTEXT-RESUME.md`。
- `--json`：输出完整机器可读结果。

正常输出控制在 20 行内。退出码：`0` 通过，`1` 阻断，`2` 配置错误。

## 协调者角色门

协调者的职责是上下文防火墙，不是更高级的 worker。

- discovery、diagnosis、implementation 必须先派单。
- 原始 rollout、session、SQLite、长日志和开放式代码扫描不得由协调者执行。
- 每次 worker 交付最多核验一个决定性证据：一个精确文件行段、一个精确命令或一次精确线程读取。
- 发现新异常时，拒绝交付、追问 worker 或新建任务，不自行顺藤摸瓜。
- `dispatchSatisfied=true` 必须同时有 task/thread ID 或 dispatch evidence。
- 压缩恢复时，`CONTEXT-RESUME.md` 首屏角色卡先于长项目说明。

## 验证

```bash
npm test
```

测试会生成：

- `reports/saturation-report.md`
- `reports/role-drift-report.md`
- `reports/boundary-report.json`

当前门槛：

- 上下文硬门场景 100% 阻断。
- 信息恢复正确率至少 95%。
- 无 Kit 基线必须实际失败或丢失关键事实。
- 角色漂移 P0 场景 100% 阻断。
- 允许的最小验收动作不得被误伤。
- 普通输出少于 20 行。

## 已知边界

- 静态 `--role` 检查判定的是提交给它的动作计划；若客户端不调用它，不能代替运行时 hook。
- 文本敏感信息扫描不能替代专用 secret scanner。
- 外部事实必须由新回执或实时观测确认，仓库快照本身不是线上事实。
- 角色契约不能证明用户决策正确，只保证身份、授权和动作边界不被悄悄改变。

## 许可证

[MIT](LICENSE)
