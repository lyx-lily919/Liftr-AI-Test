# 测试前准备：创建 VNet Skill

## 概述

本 Skill 描述在运行 NGINXaaS Networking 测试前，使用 `test-setup-vnets.js` 在 Azure Portal 自动创建两个虚拟网络的关键步骤与注意事项。

测试脚本：`test-setup-vnets.js`  
截图目录：`sc4-screenshots/`

---

## 需要创建的 VNet

| 名称 | 地址空间 | 子网 | 说明 |
|------|----------|------|------|
| `lyx-vnet01` | `10.0.0.0/28`（16 个地址） | 删除默认 /24，新增默认 /28 | 用于测试小地址空间场景 |
| `lyx-vnet02` | `10.0.0.0/16`（默认） | 保留默认 /24 子网 | 用于正常 Networking 配置 |

**公共配置：**
- Subscription：`Liftr-Nginx-Test`
- Resource Group：`lyx-liftr-test`
- Region：`West Central US`

---

## 执行方式

```bash
node test-setup-vnets.js
```

脚本具有幂等性：若 VNet 已存在则跳过创建，直接返回 Portal 首页。

---

## 关键点

### 1. 浏览器启动

优先使用系统 Edge 配置文件（`%LOCALAPPDATA%\Microsoft\Edge\User Data`）以复用登录状态。若系统 Edge 正在运行（配置文件被占用），自动 fallback 到项目内独立目录 `.edge-test-profile`。

### 2. 检查 VNet 是否已存在

在 Virtual Networks 列表页使用 `page.locator(`text="${vnetName}"`).isVisible()` 检测 VNet 是否已存在，避免重复创建。

### 3. 创建向导操作在 iframe 内

VNet 创建向导内容位于 `iframe[name="VirtualNetworkCreateV3.ReactView"]` 中，所有输入操作需在该 iframe 的 `contentFrame()` 上执行。

### 4. lyx-vnet01：修改地址空间为 /28

Address space 页面通过 Size 下拉框修改子网大小：
- 定位 Size select 元素：`select` 或 `[aria-label*="size" i]`
- 将默认 `/16` 改为 `/28`

修改后需**删除默认子网**（点击 delete 图标），再点击 **Add a subnet** 新增一个 /28 子网。

**注意**：Add subnet 侧边面板的确认按钮（"Add"）有时加载较慢，若未找到则等待后继续（默认子网的 Size 与地址空间一致，Portal 会自动补全）。

### 5. lyx-vnet02：保留默认配置

`lyx-vnet02` 无需修改 Address space，直接在 Basics 填完信息后点击 **Review + create** 即可。

### 6. 提交与等待部署

- 点击 **Review + create** → 等待 `text=Validation passed` 出现
- 点击 **Create** → 等待页面 URL 变为 `/deployments/` 路径
- 等待 `text=Your deployment is complete` 出现（超时 120 秒）

---

## 完成标志

脚本结束后浏览器保持打开，停留在 Azure Portal 首页，即可直接运行后续测试脚本（如 `test-nginxaas.js`）。
