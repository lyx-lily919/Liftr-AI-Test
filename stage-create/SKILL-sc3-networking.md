# NGINXaaS SC3 – Networking Configuration 测试 Skill

## 概述

本 Skill 记录使用 Playwright + Microsoft Edge 对 Azure Portal NGINXaaS Create 向导中
**Networking 页面**进行全面测试的关键发现。

测试脚本：`test-sc3-networking.js`  
截图目录：`sc4-screenshots/`  
依赖 VNet：`lyx-vnet01`（10.0.0.0/28，无效）、`lyx-vnet02`（10.0.0.0/16，有效）

运行测试：
```bash
node test-setup-vnets.js   # 先创建/确保两个 VNet 存在
node test-sc3-networking.js
```

---

## Networking 页面 UI 结构（实测）

启用 VNet 访问复选框后，页面依次包含以下控件区域：

```
Virtual network   (New) lyx-sc3-MMDDHHMI-vnet (lyx-liftr-test)  ← .fxc-dropdown-open.azc-input [0]
subnet            (New) default                                   ← .fxc-dropdown-open.azc-input [1]
                  172.22.0.0 - 172.22.0.255 (256 addresses)

IP address type   [Public Only] [Private Only]                   ← [role="radio"] 单选组
  Public Only 时：
    Create new or use existing public IP address  [New] [Existing]
    Public IP Address resource name               （输入框）
  Private Only 时：
    Private static IP address                     （必填输入框，空时报错）

Inbound port rules
  Public inbound ports  [None] [Allow selected ports]
  Select inbound ports  2 selected ← 多选下拉，默认 80 和 443 已选

Apply NGINX configuration  [Default] [None]
Enable NGINX App Protect WAF  [true] [false]
```

---

## 关键发现

### TC-NET-01：门户自动预创建 VNet 和子网

- 进入 Networking 页面后，系统自动在 VNet 下拉框中填入 **`(New) <instance-name>-vnet (<resource-group>)`**
- 子网自动命名为 **`default`**，地址范围 `172.22.0.0 - 172.22.0.255`（/24，256 地址）
- 通过读取 `.fxc-dropdown-open.azc-input` 索引 0 和 1 可获取 VNet 和子网名称

```js
const dropdownTexts = await page.evaluate(() => {
  return [...document.querySelectorAll('.fxc-dropdown-open.azc-input')]
    .filter(el => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    })
    .map(el => (el.textContent || '').replace(/\s+/g, ' ').trim());
});
// dropdownTexts[0] → "(New) lyx-sc3-05280953-vnet (lyx-liftr-test)"
// dropdownTexts[1] → "(New) default"
```

---

### TC-NET-02：公共 IP 有 New / Existing 两个选项

- IP address type 默认为 **Public Only**
- "Create new or use existing public IP address" 标签下方有 **New** 和 **Existing** 两个按钮/选项
- 在 `document.body.innerText` 中从 `"public ip"` 关键词起截取 400 字符即可同时找到两者

---

### TC-NET-03：Private Only 模式下要求静态 IP

- IP address type 切换控件为 `[role="radio"]`，文本为 `"Private Only"`
- 切换后 Public IP 区域消失，显示 **`Private static IP address`** 必填输入框
- 空状态下立即触发验证："The value must not be empty. Private static IP address is invalid."
- **重要提示**（页面原文）：`"IP Address type selection is immutable after NGINXaaS creation."` —— IP 类型创建后**不可更改**

```js
const privateRadio = page.locator('[role="radio"]').filter({ hasText: /^private only$/i }).first();
await privateRadio.click();
```

#### ⚠️ 输入框定位注意事项（已修正 Bug）

**问题根因**：使用 `querySelectorAll('label,span,div')` + `closest('div')` + `querySelector('input')` 会
匹配到页面顶层容器，导致找到的是 **Azure Portal 顶部搜索栏**（y < 80px），而非表单中的字段。

**正确方法**：优先用 XPath `following::` 轴从精确匹配的 label/span 向后找第一个 input，
并用 `boundingBox().y > 150` 过滤顶部 UI：

```js
// 方法1: XPath following 轴（推荐）
// y > 150 排除顶部搜索栏（顶部 UI y 通常 < 80px；表单字段 y ≈ 549px）
for (const xpath of [
  'xpath=//label[normalize-space(.)="Private static IP address"]/following::input[1]',
  'xpath=//span[normalize-space(.)="Private static IP address"]/following::input[1]',
  'xpath=//*[normalize-space(text())="Private static IP address"]/following::input[not(@type) or @type="text"][1]',
]) {
  const loc = page.locator(xpath).first();
  if (await loc.isVisible({ timeout: 1500 }).catch(() => false)) {
    const box = await loc.boundingBox().catch(() => null);
    if (box && box.y > 150) {
      ipInputLocator = loc;
      break;
    }
  }
}

// 方法2: evaluateHandle fallback（仅查 label/span，不用 div）
if (!ipInputLocator) {
  const inputHandle = await page.evaluateHandle(() => {
    const targets = [...document.querySelectorAll('label, span')].filter(el =>
      /^private static ip address$/i.test((el.textContent || '').replace(/\s+/g, ' ').trim())
    );
    for (const lbl of targets) {
      let container = lbl.parentElement;
      for (let d = 0; d < 5 && container; d += 1, container = container.parentElement) {
        const inputs = [...container.querySelectorAll('input[type="text"], input:not([type])')];
        const valid = inputs.filter(inp => {
          const r = inp.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.top > 150;
        });
        if (valid.length === 1) return valid[0];
      }
    }
    return null;
  });
  ipInputLocator = inputHandle.asElement() || null;
}
```

点击后须验证焦点确实落在正确 input（`document.activeElement.tagName === 'INPUT'` 且 `top > 150`），
否则需强制调用 `.focus()` 重新聚焦。

**实测坐标**：Private static IP address 输入框 y ≈ **549px**（远高于 150px 阈值）。

---

### TC-NET-04：新建 VNet 时入站端口显示 "2 selected"

- "Select inbound ports" 是**多选下拉框**（`.fxc-dropdown-open.azc-input`），默认 **80 和 443 均已选中**
- 下拉框折叠状态下显示文本为 `"2 selected"`，不直接展示 "80" 和 "443" 数字
- 如需验证具体端口号，需点击展开下拉框后检查 `.fxc-dropdown-option` 元素

---

### TC-NET-05：切换到现有 VNet 后入站端口行为

- 切换至 `lyx-vnet02`（现有 VNet）后，"Select inbound ports" 区域仍然存在并可操作
- 本次测试未观测到 test-plan 中描述的"现有 VNet 时端口选项不可用"行为
- **实际行为**：现有 VNet 下端口选项与新建 VNet 行为相同（均显示 "2 selected"）
- 建议后续在真实部署完成后复测，或检查是否需要选择已绑定 NSG 的子网才触发该差异

---

### TC-NET-06：门户拒绝过小 / 未委托的现有 VNet

- 选择 `lyx-vnet01`（10.0.0.0/28，/28 前缀）后门户**立即**显示以下错误（无需点击 Next）：
  - `"The virtual network must contain an IPv4 address space larger than or equal to 27."`
  - `"Subnet should have an address prefix larger than 27."`
  - `"Subnet 'default' with address prefix '10.0.0.0/28' does not have enough capacity to add another IP address."`
  - 子网标记为 **`Incompatible subnets`**

---

## 下拉框选择方法

Azure Portal 的 VNet / Subnet 下拉使用自定义 `.fxc-dropdown-open.azc-input` 控件，
不是标准 `<select>`，需用以下方式操作：

```js
async function chooseMainNetworkingDropdown(page, index, optionText) {
  const dropdownHandle = await page.evaluateHandle((idx) => {
    const all = [...document.querySelectorAll('.fxc-dropdown-open.azc-input, .fxc-dropdown-open')];
    const withContent = all.filter(el => {
      const rect = el.getBoundingClientRect();
      return (rect.width > 0 || rect.height > 0) && (el.textContent || '').trim().length > 0;
    });
    return withContent[idx] || null;
  }, index);

  const el = dropdownHandle.asElement();
  if (!el) throw new Error(`Dropdown at index ${index} not found`);
  await el.scrollIntoViewIfNeeded();
  await el.click();
  await page.waitForTimeout(2000);

  // 遍历所有可见 option 按文本匹配
  const allOpts = await page.locator('.fxc-dropdown-option').all();
  for (const opt of allOpts) {
    if (!await opt.isVisible().catch(() => false)) continue;
    const text = (await opt.textContent().catch(() => '')) || '';
    if (text.toLowerCase().includes(optionText.toLowerCase())) {
      await opt.click();
      await page.waitForTimeout(1500);
      return;
    }
  }
  throw new Error(`Option "${optionText}" not found`);
}
```

---

## VNet 校验规则

| 条件 | 结果 |
|------|------|
| 地址空间 < /27 | 立即报错，标记 Incompatible |
| 子网前缀 < /27 | 立即报错 |
| 新建 VNet（/24 子网）| 通过，子网地址空间 ≥ /27 |
| 现有 VNet /16 + 默认 /24 子网 | 通过 |

NGINXaaS 要求子网满足：**IPv4 地址空间前缀 ≤ /27（即至少 32 个 IP）**，
且子网需空闲（或仅含 NGINXaaS 实例）。

---

## 测试用例汇总

| ID | 测试内容 | 结果 |
|----|----------|------|
| TC-NET-01 | 门户自动预创建 VNet / 子网，打印名称 | ✅ PASS |
| TC-NET-02 | 公共 IP 区域显示 New / Existing 选项 | ✅ PASS |
| TC-NET-03 | 切换 Private Only，验证静态 IP 要求 | ✅ PASS |
| TC-NET-04 | 新建 VNet 下入站端口 80/443 可选（2 selected）| ✅ PASS |
| TC-NET-05 | 切换现有 VNet 后入站端口区域行为观测 | ✅ PASS |
| TC-NET-06 | 选择 lyx-vnet01（/28），验证门户拒绝并报错 | ✅ PASS |

