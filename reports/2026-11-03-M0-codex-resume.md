# M0 — Codex app-server 持久线程最小验证

- 日期：2026-11-03 01:18–01:30 +0800
- 主机：`desktop-kfscv8c-1`（100.126.54.11，OS 用户 `king_`）
- 宿主：DSH Desktop 0.2.1-rc.5（**本阶段未使用 DSH**）
- Codex：`codex-cli 0.166.0-alpha.5.1`，`C:\Users\king_\AppData\Local\OpenAI\Codex\bin\22cfb1d302613eae\codex.exe`
- `CODEX_HOME`：`C:\Users\king_\.codex`（`auth.json` 存在；model `gpt-6.1-sol`，effort `medium`）
- 结论：**结构验证 PASS；语义/工具使用验证 BLOCKED（ChatGPT 周配额 100%，2026-11-04 14:36 +0800 重置）**

## 1. 目标

证明「非临时 Codex 线程 + `thread/resume`」可行：同一 thread 在 app-server 进程退出、新进程启动后仍能接上，且历史（用户消息）随 resume 返回。通过后再写 DSH 插件。

## 2. 方法

脚本（均只读 DSH，创建真实 Codex 线程）：

| 脚本 | 作用 |
|---|---|
| `codex-advisor/spike/appserver-probe.mjs` | 进程 A：initialize → `thread/start{ephemeral:false,cwd,sandbox:"read-only",approvalPolicy:"never"}` → turn1；关闭 A；进程 B：initialize → `thread/resume{threadId}` → turn2；负例 resume 随机 id；中断测试 |
| `codex-advisor/spike/thread-history-probe.mjs` | 只 resume + `thread/read` + `thread/list`，**不调用 turn/start**（零模型配额） |
| `codex-advisor/spike/writer-conflict-probe.mjs` | 两个 app-server 同时 resume 同一线程，观察 writer 锁 |

原始证据（JSON/NDJSON）：

- `codex-advisor/spike/runs/2026-11-02T17-18-59-576Z/`（主探针，UTC 目录名）
- `codex-advisor/spike/runs/2026-11-02T17-25-25-301Z-history/history.json`
- `codex-advisor/spike/runs/2026-11-02T17-29-04-245Z-writer/writer.json`

## 3. 结果

### 3.1 线程创建与持久化 — PASS

```
thread/start {cwd:"E:\\__VIVE__\\Documents\\deepseek-harness\\default-workspace",
              ephemeral:false, approvalPolicy:"never", sandbox:"read-only"}
→ thread.id = 01a19d45-8029-7260-b454-d04800977709
  ephemeral = false
  model = gpt-6.1-sol, reasoningEffort = medium
```

`thread/list {limit:10}` 能看到该 id（status idle），说明线程已写入 Codex 线程清单，不是进程内临时对象。

### 3.2 跨进程 resume — PASS

进程 A 退出后，进程 B：

```
thread/resume {threadId:"01a19d45-8029-7260-b454-d04800977709"}
→ thread.id 与请求一致；turnCount=3；cwd/model/effort 保持；status={type:"idle"}
thread/loaded/list → ["01a19d45-8029-7260-b454-d04800977709"]
```

`thread/resume` 只发送 `{threadId}` 即被 0.166 接受；返回体包含完整 `thread.turns`。

### 3.3 历史内容随 resume 返回 — PASS

对 resume 返回的 3 个 turn 的 item 文本做检索：

- `AMBER-WALRUS-2290`（turn1 中要求记住的 token）：**found**
- `fixture.txt`（turn1 中要求读取的文件路径）：**found**
- 总文本 1009 字节

说明会话历史完整保存在 Codex 侧，并随 resume 回到新进程；模型在配额恢复后可看到这些内容。

### 3.4 错误形态 — PASS（可结构化映射）

| 场景 | 结果 |
|---|---|
| resume 不存在的线程 | `-32600  no rollout found for thread id <uuid>` |
| 两个 app-server 同时 resume 同一线程 | 第二个：`-32600  thread <id> already has an active writer` |
| 第二个进程 `thread/read`（只读） | **成功**，turnCount=3（读不受 writer 锁影响） |

→ 设计映射：`no rollout found` → `CODEX_THREAD_NOT_FOUND`（fail-closed 新线程）；`already has an active writer` → `CODEX_THREAD_BUSY`（不抢占）。

### 3.5 配额 — **BLOCKED**

`account/rateLimits/read`：

```
ordinaryUsageAllowed: false
planType: "plus"
primary:   usedPercent 0,   window 300 min,   resets 2026-11-03 06:19:01 +0800
secondary: usedPercent 100, window 10080 min, resets 2026-11-04 14:36:11 +0800
credits:   hasCredits false, balance "0"
rateLimitReachedType: "rate_limit_reached"
```

turn1 / turn2 均在 ~112s 后返回：

```
status: failed
error.codexErrorInfo: usageLimitExceeded
error.message: "You've hit your usage limit. ... try again at Nov 4th, 2026 2:36 PM."
```

因此以下**未能验证**（待配额恢复后补测）：

- turn2 模型是否真的引用 turn1 的 token（语义连续性；结构上历史已在）。
- 只读沙箱下的文件读取工具是否能执行（turn 在生成工具调用前就失败）。
- `turn/interrupt` 的实际中断效果（turn 因配额立即失败，未进入运行态）。
- 交互审批自动拒绝是否在真实 turn 中触发。

### 3.6 其他观察

- `initialize` 耗时 220–438 ms；`thread/start` 快；启动时加载了用户配置（`disabledPluginIds`、`runtimeWorkspaceRoots` 出现在 `thread/start` 结果里），未观察到明显卡顿。
- `model/list {limit:100}` 返回 8 个模型，含 `gpt-6.1-sol`。
- 每次失败 turn 耗时约 112s，说明桥在**预检配额**时应直接失败，避免把 112s 的重试等成工具超时。

## 4. M0 判定

| 项 | 结果 |
|---|---|
| 非临时线程可创建 | PASS |
| 进程重启后同 id resume | PASS |
| resume 带回历史 | PASS |
| 缺失线程/写入冲突错误可区分 | PASS |
| 真实 turn 的语义连续 / 只读工具 / 中断 | **BLOCKED — 配额** |

**G0：结构 PASS，语义待补（配额 2026-11-04 14:36 +0800 重置）。**

## 5. 对设计的影响（已纳入 M1）

1. 桥启动/每次 ask 前读 `account/rateLimits/read`（缓存 60s）；`ordinaryUsageAllowed=false` 时立即返回 `CODEX_QUOTA_EXCEEDED` + 重置时间，不等 turn。
2. 错误映射：`no rollout found` → `CODEX_THREAD_NOT_FOUND`；`active writer` → `CODEX_THREAD_BUSY`。
3. `thread/read` 可作为 `codex_status` 的只读诊断（即使 Desktop 持有 writer 也能读）。
4. `thread/resume` 参数最小集 `{threadId}` 已验证；不要把 Hermes 的 `cwd/personality/developerInstructions` 当作必需。
5. 线程无 `name`（`name:null`）；首条消息中带「DSH advisor for <session>」标识，便于在 Codex 清单里辨认。
6. 空闲回收策略保留：writer 锁是真实存在的（`active writer`），Desktop 一旦打开顾问线程，桥必须报 busy 或等空闲回收。

## 6. 复现命令

```powershell
# 主探针（会创建真实线程；配额恢复后才会产生真实回答）
node .\codex-advisor\spike\appserver-probe.mjs `
  "C:\Users\king_\AppData\Local\OpenAI\Codex\bin\22cfb1d302613eae\codex.exe" `
  "E:\__VIVE__\Documents\deepseek-harness\default-workspace"

# 历史读取（零配额）
node .\codex-advisor\spike\thread-history-probe.mjs `
  "01a19d45-8029-7260-b454-d04800977709" `
  "C:\Users\king_\AppData\Local\OpenAI\Codex\bin\22cfb1d302613eae\codex.exe"

# writer 锁（零配额）
node .\codex-advisor\spike\writer-conflict-probe.mjs `
  "01a19d45-8029-7260-b454-d04800977709" `
  "C:\Users\king_\AppData\Local\OpenAI\Codex\bin\22cfb1d302613eae\codex.exe"
```

## 7. 待办（M0 补测，配额恢复后）

- [ ] turn2 复述 token（语义连续）
- [ ] 只读沙箱读取 fixture.txt
- [ ] `turn/interrupt` 观察 `turn/completed.status="interrupted"`
- [ ] 真实 turn 中的审批请求自动拒绝路径
- [ ] 记录一次完整 turn 的耗时与 token 用量（若 `turn/completed` 提供 usage）
