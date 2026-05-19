## ADDED Requirements

### Requirement: Upload Python script
用户 SHALL 能够通过上传 `.py` 文件将策略脚本注入系统。

#### Scenario: Successful file upload
- **WHEN** 用户选择一个 `.py` 文件并点击"解析"
- **THEN** 系统读取文件内容并提交给 LLM 解析，展示 loading 状态

#### Scenario: Non-Python file rejected
- **WHEN** 用户上传非 `.py` 文件
- **THEN** 系统显示错误提示，拒绝提交

---

### Requirement: Paste Python script
用户 SHALL 能够通过粘贴代码文本将策略脚本注入系统。

#### Scenario: Paste and parse
- **WHEN** 用户在代码粘贴框中输入 Python 代码并点击"解析"
- **THEN** 系统将代码内容提交给 LLM 解析，展示 loading 状态

#### Scenario: Empty input rejected
- **WHEN** 用户未输入任何内容即点击"解析"
- **THEN** 系统显示输入不能为空的提示，不提交

---

### Requirement: LLM parses script via tool_use
系统 SHALL 使用 Claude API tool_use 模式解析脚本，以结构化方式返回策略信息。

#### Scenario: Successful parse
- **WHEN** 系统提交脚本给 LLM
- **THEN** LLM 通过 `parse_strategy` 工具调用返回 `{ name, symbols, content }`，其中 content 为 markdown 格式策略描述（含策略概述、触发条件、仓位操作、关键参数表格）

#### Scenario: Unrecognizable script
- **WHEN** 脚本内容无法识别为有效策略（如空文件、非策略相关代码）
- **THEN** LLM 返回 symbols 为空数组，前端展示警告提示用户手动补充

---

### Requirement: User reviews and edits parsed result
用户 SHALL 能够在保存前查看并编辑 LLM 解析结果。

#### Scenario: Preview displayed
- **WHEN** LLM 解析完成
- **THEN** 前端展示 markdown 渲染的策略描述预览和可编辑的 symbols 标签列表

#### Scenario: User edits symbols
- **WHEN** 用户修改 symbols 列表（增加或删除股票代码）
- **THEN** 修改后的 symbols 在确认保存时写入数据库

#### Scenario: User edits strategy name
- **WHEN** 用户修改策略名称
- **THEN** 修改后的名称在确认保存时写入数据库

---

### Requirement: Strategy saved to database
用户确认后，系统 SHALL 将策略存入数据库。

#### Scenario: Successful save
- **WHEN** 用户点击"确认保存"
- **THEN** 系统将 name、symbols、content（markdown）、script（原始 Python 代码）写入 strategies 表，并跳转到策略详情页

#### Scenario: Duplicate name handling
- **WHEN** 用户保存的策略名称与已有策略重名
- **THEN** 系统提示名称重复，要求用户修改后重新保存

---

### Requirement: Strategy detail shows description and script
用户 SHALL 能够在策略详情页查看 LLM 生成的 markdown 描述和原始 Python 脚本。

#### Scenario: Markdown description tab
- **WHEN** 用户进入策略详情页的"策略描述" Tab
- **THEN** 系统渲染并展示 markdown 格式的策略描述

#### Scenario: Original script tab
- **WHEN** 用户进入策略详情页的"原始脚本" Tab
- **THEN** 系统以代码块形式展示原始 Python 脚本，支持复制
