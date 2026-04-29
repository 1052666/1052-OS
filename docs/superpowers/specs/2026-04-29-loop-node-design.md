# Loop 节点设计文档

## 概述

在编排系统中新增「循环节点」类型。循环节点是一个容器，内含一个子任务（支持内嵌配置或引用已有资源），由列表变量驱动循环执行。

## 需求

- 新增 `loop` 节点类型，外观与现有节点一致（标准卡片）
- 子任务支持两种模式：内嵌配置（复用现有节点类型的能力）和引用已有资源（编排、SQL 文件、Shell 脚本文件）
- 循环变量统一引用已有的 SQL 变量（复用现有变量系统）
- 支持可配置的失败策略：停止 / 继续
- 引用编排时，通过变量名传递循环变量到子编排；引用 SQL/Shell 文件时，用 `${varName}` 占位符替换

## 数据模型

### 新增类型定义（orchestration.types.ts）

```typescript
type LoopSubTaskInline = {
  mode: 'inline'
  type: 'sql' | 'debug' | 'load' | 'wait' | 'shell'
}

type LoopSubTaskReference = {
  mode: 'reference'
  refType: 'orchestration' | 'sqlFile' | 'shellFile'
  refId: string
  variableName?: string  // 仅 refType='orchestration' 时使用，传递给子编排的变量名
}

type LoopConfig = {
  variableId: string
  failureStrategy: 'stop' | 'continue'
  subTask: LoopSubTaskInline | LoopSubTaskReference
}
```

### OrchestrationNode 变更

- `type` 联合类型加入 `'loop'`
- 新增 `loop?: LoopConfig` 字段
- inline 模式的子任务配置字段直接复用节点本身字段（`datasourceId`, `sql`, `sqlFileId`, `shellContent`, `targetDatasourceId`, `targetTable` 等），避免重复定义
- `loop.subTask` 仅记录模式和类型/引用信息

### LogEntry 变更

- `nodeType` 联合类型加入 `'loop'`
- 每次迭代生成日志，`nodeId` 格式为 `${node.id}-loop-${i}`，`nodeName` 为 `${node.name} (循环 ${i+1}/${total})`
- 维护一条汇总日志，`nodeId` 为节点原始 id

## 后端执行引擎

### 新增函数 executeLoopNode

位于 `orchestration.service.ts`，流程：

1. 根据 `loop.variableId` 获取 SQL 变量，调用 `resolveSqlVariableList` 得到列表值
2. 若列表为空，返回成功日志（affectedRows: 0）
3. 遍历每个值：

   **inline 模式：**
   - 构造临时 OrchestrationNode（type 取自 `subTask.type`，其余配置字段来自当前节点）
   - 调用现有 `executeNode(tempNode, signal, pushLog, { varName, value })`
   - 复用已有的 loopContext 变量注入机制

   **reference + sqlFile：**
   - 通过 `getSqlFile(refId)` 读取 SQL 文件内容
   - 注入 `${varName}` 替换为当前循环值
   - 调用 `resolveVariables` 解析其他变量
   - 执行 SQL 查询

   **reference + shellFile：**
   - 通过 `getShellFile(refId)` 读取脚本内容
   - 注入 `${varName}` 替换为当前循环值
   - 在目标服务器或本地执行

   **reference + orchestration：**
   - 通过 `readOrchFile(refId)` 读取子编排
   - 遍历子编排所有节点，将 `${variableName}` 替换为当前循环值
   - 在当前 signal 控制下同步执行子编排 DAG
   - 子编排执行结果合并到当前编排日志

4. 失败策略处理：
   - `stop`：某次迭代失败立即终止循环，节点标记为失败
   - `continue`：跳过失败继续执行，最终汇总成功/失败数量
5. 返回汇总 LogEntry（status 根据 failedCount 判断：全部失败=failed，部分失败=warning，全部成功=success）

### DAG 调度集成

- `executeNode` 函数的 switch 中新增 `node.type === 'loop'` 分支，调用 `executeLoopNode`
- 循环节点在 DAG 中作为普通节点参与拓扑排序，无需特殊边或拓扑处理

## 前端 UI

### 节点外观

- 标准卡片，与现有节点一致
- 图标：循环符号 ⟳，颜色 `#8b5cf6`

### 配置抽屉（NodeConfigDrawer）

分两部分：

**上半部分 — 循环配置：**
- 循环变量：下拉选择已有 SQL 列表变量（过滤 `valueType='sql'` 或 `isList=true` 的变量）
- 失败策略：切换按钮，选项：`停止` / `继续`

**下半部分 — 子任务配置：**
- 模式切换：`内嵌` / `引用`
- **内嵌模式：**
  - 子任务类型选择器：SQL / Debug / 加载 / Wait / Shell
  - 选中类型后，动态渲染对应类型的配置表单组件（复用 `SqlNodeConfig`、`DebugNodeConfig`、`LoadNodeConfig`、`WaitNodeConfig`、`ShellNodeConfig`）
- **引用模式：**
  - 引用类型选择器：编排 / SQL 文件 / Shell 脚本
  - 选中后显示对应资源的下拉列表
  - 选择编排时额外显示「传递变量名」输入框

### 新增文件

- `frontend/src/components/orchestration/nodes/LoopNode.tsx` — 节点渲染组件
- `frontend/src/components/orchestration/panels/LoopNodeConfig.tsx` — 配置表单组件

### 改动文件

- `frontend/src/components/orchestration/AddNodeDialog.tsx` — NODE_OPTIONS 加 loop 选项
- `frontend/src/components/orchestration/panels/NodeConfigDrawer.tsx` — TYPE_CONFIG 加 loop，renderForm 加 case
- `frontend/src/components/orchestration/nodes/BaseNode.tsx` — TYPE_CONFIG 加 loop 样式
- `frontend/src/components/orchestration/hooks/useOrchestrationEditor.ts` — OrchNodeType 加 `'loop'`，addNode nameMap 加 loop，默认值加 loop 字段
- `backend/src/modules/orchestration/orchestration.types.ts` — type 联合加 `'loop'`，新增 LoopConfig 相关类型，LogEntry nodeType 加 `'loop'`
- `backend/src/modules/orchestration/orchestration.service.ts` — 新增 executeLoopNode，executeNode 加 loop 分支
