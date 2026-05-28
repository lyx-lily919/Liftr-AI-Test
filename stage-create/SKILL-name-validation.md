# NGINXaaS Name 字段非法值验证测试 Skill

## 概述

本 Skill 描述如何使用 Playwright + Microsoft Edge 对 Azure Portal NGINXaaS Create 向导中 **Basics 页面的 Name 字段**进行非法值边界验证。测试涵盖：空值、超长、连字符位置、非法字符等 11 个典型非法 Name 用例、1 个 Resource Group 空值用例（TC-RG-01），以及最终合法值的正向验证。

测试脚本：`test-nginxaas-name-validation.js`  
截图目录：`name-validation-screenshots/`  
JSON 报告：`name-validation-screenshots/report.json`

---

## 验证规则来源

页面 Name 字段下方的提示文本：

> *"Only alphanumeric characters are allowed, and the value must be 1-30 characters long. It cannot begin or end with a hyphen."*

实际含义：
- 允许**字母（A-Z / a-z）、数字（0-9）、连字符（-）**
- 长度 **1–30** 个字符
- **不能**以连字符开头或结尾

---

## 环境要求

| 依赖 | 版本要求 |
|------|----------|
| Node.js | >= 18 |
| Playwright | >= 1.59 |
| 浏览器 | Microsoft Edge (msedge channel) |

```bash
npm install playwright
```

运行测试：

```bash
node test-nginxaas-name-validation.js
```

---

## 测试用例设计

| ID | 输入值 | 违反的规则 |
|----|--------|-----------|
| TC-01 | `""` (空) | 长度必须 ≥ 1，字段不能为空 |
| TC-02 | 31 个字母（`aaa...31字符`）| 长度必须 ≤ 30 |
| TC-03 | `-lyx-test` | 不能以连字符**开头** |
| TC-04 | `lyx-test-` | 不能以连字符**结尾** |
| TC-05 | `-lyx-test-` | 两端均为连字符 |
| TC-06 | `lyx test` | 含**空格**（非字母数字字符） |
| TC-07 | `lyx_test` | 含**下划线**（非字母数字字符） |
| TC-08 | `lyx@test` | 含 `@` 符号 |
| TC-09 | `lyx.test` | 含点号 `.` |
| TC-10 | `lyx#test!` | 含 `#` `!` 特殊字符 |
| TC-11 | `中文名称` | 含非 ASCII 字符 |
| TC-RG-01 | （空，Resource Group 未选择） | Resource Group 不能为空；经 Review+create 往返后应触发 "The value must not be empty." |
| TC-RG-02 | （点击 "Create new"） | 验证 Resource Group 下方的 "Create new" 可点击元素在页面中可见 |
| TC-RG-03 | `""` （弹框 Name 为空） | RG 弹框 Name 不能为空；点击 OK 后弹框不关闭（提交被阻止） |
| TC-RG-04 | `rg-test.` | 末尾句点不合法；弹框应显示 RG 名称格式错误提示 |
| TC-RG-05 | `rg!test` | 感叹号为非合法字符；弹框应显示 RG 名称格式错误提示 |
| TC-RG-VALID | `lyx-rg-test` | 合法 RG 名称；无错误提示，点击 OK 后弹框关闭，RG 字段更新 |
| FINAL | `lyx-stage-0514` | 合法值，验证错误应清除 |

---

## 测试步骤详解

### Step 1–8：进入 Create 向导并定位 Name 输入框

前置步骤（启动浏览器、登录、搜索 NGINXaaS、进入 Create 页面）与主流程脚本相同，参见 `SKILL.md`。

进入 Create 向导后，等待 Basics 页面渲染完成，通过 `label.htmlFor` 属性定位 Name 输入框：

```js
await page.waitForSelector('text=Project details', { timeout: 30000 });

const nameInputId = await page.evaluate(() => {
  const label = [...document.querySelectorAll('label')]
    .find(l => /^Name\b/.test((l.textContent || '').trim()));
  return label?.htmlFor || null;
});

const nameInput = nameInputId
  ? page.locator(`[id="${nameInputId}"]`)
  : page.locator('input[type="text"]').filter({ hasNot: page.locator('[aria-haspopup]') }).first();

await nameInput.waitFor({ state: 'visible', timeout: 10000 });
```

**关键点：**
- 用 `label.htmlFor` 获取 input 的 ID 再精确定位，避免 `getByLabel` 匹配到 label 的包裹容器
- 兜底选择器过滤掉含 `aria-haspopup` 的下拉控件，确保匹配到纯文本输入框

---

### Step 9：填写 Name 并触发失焦验证

```js
async function fillNameAndTriggerValidation(page, nameInput, value) {
  await nameInput.click({ clickCount: 3 }); // 全选已有内容
  if (value === '') {
    await nameInput.press('Delete');          // 清空
  } else {
    await nameInput.fill(value);
  }
  await page.waitForTimeout(300);
  await nameInput.press('Tab');              // 失焦，触发 blur 验证
  await page.waitForTimeout(800);
  return getNameErrorMessage(page);
}
```

**关键点：**
- `click({ clickCount: 3 })` 全选现有内容，保证每次用例相互独立
- 空值用 `press('Delete')` 而非 `fill('')`，`fill('')` 在某些情况下不触发 React 的 onChange
- `press('Tab')` 使字段失焦，触发 Azure Portal 对 Name 字段的即时 blur 验证

---

### Step 10：读取 Name 字段的错误提示状态

```js
async function getNameErrorMessage(page) {
  return page.evaluate(() => {
    const label = [...document.querySelectorAll('label')]
      .find(l => /^Name\b/.test((l.textContent || '').trim()));
    const inputId = label?.htmlFor;
    const input = inputId
      ? document.getElementById(inputId)
      : document.querySelector('input[type="text"]');

    if (!input) return { ariaInvalid: null, errorText: null };

    const ariaInvalid = input.getAttribute('aria-invalid');

    let container = input.parentElement;
    for (let depth = 0; depth < 8 && container; depth++, container = container.parentElement) {
      // 优先：aria-errormessage / aria-describedby 指向的元素
      const errId = input.getAttribute('aria-errormessage') || input.getAttribute('aria-describedby');
      if (errId) {
        const errEl = document.getElementById(errId.split(' ')[0]);
        if (errEl) {
          const t = (errEl.innerText || errEl.textContent || '').replace(/\s+/g, ' ').trim();
          if (t) return { ariaInvalid, errorText: t };
        }
      }
      // 次优：role="alert" 或 aria-live 的后代
      for (const el of container.querySelectorAll('[role="alert"], [aria-live="assertive"], [aria-live="polite"]')) {
        const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (t) return { ariaInvalid, errorText: t };
      }
      // 兜底：class 含 error / invalid / errorMessage 的节点
      for (const el of container.querySelectorAll(
        'span[class*="error"], div[class*="error"], span[class*="invalid"], div[class*="invalid"], span[class*="errorMessage"], div[class*="errorMessage"]'
      )) {
        const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (t) return { ariaInvalid, errorText: t };
      }
    }
    return { ariaInvalid, errorText: null };
  });
}
```

**关键点：**
- **`aria-invalid` 是有效性的权威来源**：值为 `"true"` 表示字段验证未通过
- 错误文本通过三级策略查找：`aria-errormessage` → `role="alert"` → `class*="error"` 节点
- 向上遍历最多 8 层父容器，适应不同 Portal 表单控件的嵌套深度

---

### Step 11（特殊）：空值（TC-01）的触发方式

Azure Portal 对空值的验证**不在 `blur` 时触发**，而是推迟到用户尝试导航时才批量标记所有未填字段。

触发方式：先切到 **Review + create** 标签页，再切回 **Basics** 标签页，Portal 即会将空 Name 标记为 `aria-invalid="true"`。

```js
if (tc.input === '' && ariaInvalid !== 'true' && !errorText) {
  console.log('  [TC-01] blur 未触发错误，切换到 Review + create 标签页...');

  // Create 向导的标签页是 role="tab" 元素（tablist 内），不是 a/button
  const reviewTab = page.getByRole('tab', { name: /review.*create/i }).first();
  await reviewTab.waitFor({ state: 'visible', timeout: 10000 });
  await reviewTab.click();
  await page.waitForTimeout(2000);

  // 切回 Basics；切换后 Basics 标签文本可能附加错误计数（"Basics (1)"），使用宽松匹配
  const basicsTab = page.getByRole('tab', { name: /basics/i }).first();
  await basicsTab.waitFor({ state: 'visible', timeout: 10000 });
  await basicsTab.click();
  await page.waitForTimeout(1500);

  // 等待输入框重新可见后再读取错误状态
  await nameInput.waitFor({ state: 'visible', timeout: 10000 });
  ({ ariaInvalid, errorText } = await getNameErrorMessage(page));
}
```

**关键点：**
- 切到 Review + create 并切回后，空值的 Name 字段会显示：
  > *"The value must not be empty. Only alphanumeric characters are allowed, and the value must be 1-30 characters long. It cannot begin or end with a hyphen."*
- **标签页必须用 `getByRole('tab')`**：Azure Portal Create 向导中标签页是 `role="tab"` 元素，用 `locator('a:has-text(...)')` 或 `locator('button:has-text(...)')` 找不到
- 切回后 Basics 标签名称可能变为 `"Basics (1)"`（含错误数量提示），应使用 `/basics/i` 宽松匹配而非 `/^basics$/i`

---

### Step 11b（TC-RG-01）：Resource Group 为空时经 Review+create 往返触发空值错误

Azure Portal 对 Resource Group 的空值验证同样**不在 blur 时触发**，需经由导航触发批量校验。

触发步骤与 TC-01 相同：切到 **Review + create** 标签页 → 切回 **Basics** 标签页，此后 Resource Group 下拉框下方应出现 *"The value must not be empty."* 提示。

```js
// 切换到 Review + create
const reviewTabRG = page.getByRole('tab', { name: /review.*create/i }).first();
await reviewTabRG.waitFor({ state: 'visible', timeout: 10000 });
await reviewTabRG.click();
await page.waitForTimeout(2000);

// 切回 Basics
const basicsTabRG = page.getByRole('tab', { name: /basics/i }).first();
await basicsTabRG.waitFor({ state: 'visible', timeout: 10000 });
await basicsTabRG.click();
await page.waitForTimeout(1500);

// 多策略检测 Resource Group 错误文本
const rgError = await page.evaluate(() => {
  function findErrorInNode(root) {
    for (const el of root.querySelectorAll('[role="alert"], [aria-live="assertive"], [aria-live="polite"]')) {
      const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (t) return t;
    }
    for (const el of root.querySelectorAll(
      '[class*="validationMessage"], [class*="ValidationMessage"], [class*="errorMessage"], [class*="ErrorMessage"], ' +
      '[class*="fieldError"], span[class*="error"], div[class*="error"], span[class*="invalid"], div[class*="invalid"]'
    )) {
      const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (t && t.length < 300) return t;
    }
    return null;
  }

  // 策略 1：从 "Resource group" 文本标签向上遍历，找含 combobox 的容器后查 alert
  const rgLabelEl = [...document.querySelectorAll('label, span, div, p')]
    .find(el => {
      if (el.children.length > 3) return false;
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      return /^resource\s*group/i.test(text) && text.length < 60;
    });

  if (rgLabelEl) {
    let node = rgLabelEl.parentElement;
    for (let depth = 0; depth < 12 && node && node !== document.body; depth++, node = node.parentElement) {
      const combobox = node.querySelector('[role="combobox"], select, [role="listbox"]');
      if (combobox) {
        const ariaInvalid = combobox.getAttribute('aria-invalid');
        const errText = findErrorInNode(node);
        if (errText) return { ariaInvalid, errorText: errText };
      }
    }
  }

  // 策略 2：在所有 alert/aria-live 元素中直接匹配期望文本
  for (const el of document.querySelectorAll('[role="alert"], [aria-live="assertive"], [aria-live="polite"]')) {
    const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    if (/the value must not be empty/i.test(t)) return { ariaInvalid: 'true', errorText: t };
  }

  // 策略 3：在 error/invalid/validation class 元素中匹配期望文本
  for (const el of document.querySelectorAll('[class*="error" i], [class*="invalid" i], [class*="validation" i]')) {
    const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    if (/the value must not be empty/i.test(t)) return { ariaInvalid: 'true', errorText: t };
  }

  return { ariaInvalid: null, errorText: null };
});

const rgPassed = !!(rgError.errorText && rgError.errorText.includes('The value must not be empty.'));
```

**关键点：**
- Azure Portal 的 Resource Group combobox **没有标准 `label[for]` / `id` 关联**，不能用 `label.htmlFor` 方式定位控件，需改用文本匹配 label → 向上遍历找含 `combobox` 的容器
- 错误检测采用三级策略，最终兜底为直接扫描全页 `[role="alert"]` 中包含期望文本的节点
- 触发方式与 TC-01 相同，但本测试点关注的是 Resource Group 字段，而非 Name 字段
- 测试中从未主动填写 Resource Group，因此无需额外清空操作，控件始终处于空状态

---

### Step 11c（TC-RG-02~05 + TC-RG-VALID）："Create new" 弹框 RG Name 验证

Azure Portal Resource Group 下拉框旁边有 **"Create new"** 链接，点击后会弹出一个 **内联 callout**（并非 `role="dialog"` 模态框），允许用户在不离开 Create 向导的情况下创建新 RG。本节涵盖对该弹框的五个测试用例。

#### TC-RG-02：验证 "Create new" 可点击元素可见

```js
const createNewEl = page.getByRole('button', { name: /create new/i })
  .or(page.locator('a').filter({ hasText: /^create new$/i }))
  .first();
await createNewEl.waitFor({ state: 'visible', timeout: 10000 });
// PASS 即元素存在且可见
```

**关键点：**
- "Create new" 在 Azure Portal 中可能是 `<button>` 或 `<a>` 元素；用 `.or()` 兼容两种形式

---

#### 弹框检测（TC-RG-03~VALID 公共前置步骤）

Azure Portal 的 "Create new" 弹框是 **inline callout**，没有 `role="dialog"` 或 `role="alertdialog"` 属性。无法用 `page.locator('[role="dialog"]')` 检测。

替代方案：以弹框内 **Cancel 按钮**作为弹框出现的信号。

```js
await createNewEl.click();

// 用 Cancel 按钮检测弹框，而非 role="dialog"（弹框是 inline callout，无 role="dialog"）
const popupCancelBtn = page.getByRole('button', { name: 'Cancel' });
let popupDetected = false;
try {
  await popupCancelBtn.waitFor({ state: 'visible', timeout: 8000 });
  popupDetected = true;
} catch (_) { popupDetected = false; }
```

弹框内 Name input 的定位方法（XPath 从 Cancel 按钮所在容器向上查找，iframe 安全）：

```js
// XPath 从 Cancel locator 向上找最近含 input 的祖先容器，再向下找 input
// 不能用 page.evaluate()（只在主框架运行，弹框可能在 iframe 内）
const rgNameInput = popupCancelBtn.locator(
  'xpath=ancestor::*[.//input][1]//input'
).first();
await rgNameInput.waitFor({ state: 'visible', timeout: 10000 });
```

**关键点：**
- `page.evaluate()` 只在**主框架**执行；Azure Portal 弹框可能在 `<iframe>` 内，需改用 `locator.evaluate()` 以在 locator 所在 frame 中执行
- `locator.locator('xpath=ancestor::...')` 是在 locator 所在 frame 内做相对 XPath 查找，确保在正确的 frame 上下文中运行

---

#### 弹框错误文本检测辅助函数

```js
async function getRGDialogError() {
  return popupCancelBtn.evaluate((btn) => {
    let node = btn.parentElement;
    for (let i = 0; i < 12 && node && node !== document.body; i++, node = node.parentElement) {
      if (!node.querySelector('input')) continue;
      for (const el of node.querySelectorAll('[role="alert"], [aria-live="assertive"], [aria-live="polite"]')) {
        const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (t) return t;
      }
      for (const el of node.querySelectorAll(
        '[class*="validationMessage"], [class*="ValidationMessage"], [class*="errorMessage"], [class*="ErrorMessage"], ' +
        'span[class*="error"], div[class*="error"], span[class*="invalid"], div[class*="invalid"]'
      )) {
        const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (t && t.length < 400) return t;
      }
    }
    return null;
  });
}
```

使用 `popupCancelBtn.evaluate()` 而非 `page.evaluate()`，确保回调在 Cancel 按钮所在 frame 中执行。

---

#### TC-RG-03：RG 名称为空 — OK 被阻止（行为测试）

Azure Portal 的 Fluent UI OK 按钮在空值时呈视觉禁用（灰色），但**不设置**任何标准禁用属性：
- 无 `disabled` 属性
- 无 `aria-disabled="true"`
- `pointer-events` 不是 `none`
- `opacity` 不低于 0.7
- 无 `cursor: not-allowed`
- className 不含 "disabled" 或 "is-disabled"

因此无法用属性检查判断禁用状态，改用**行为测试**：

```js
if (tc.input === '') {
  const okDisabled = await isOKButtonDisabled(); // 先尝试属性检查（兜底）
  if (okDisabled) {
    passed = true;
    errorText = '（OK 按钮已禁用，空值不可提交）';
  } else {
    // 行为测试：点击 OK，检查弹框是否仍然开着
    const okBtnLocator = page.getByRole('button', { name: 'OK' }).first();
    await okBtnLocator.click().catch(() => {});
    await page.waitForTimeout(800);
    const cancelStillVisible = await popupCancelBtn.isVisible({ timeout: 1000 }).catch(() => false);
    if (cancelStillVisible) {
      // 弹框未关闭 = 提交被阻止 = PASS
      errorText = await getRGDialogError() || '（点击 OK 后弹框未关闭，空值提交被阻止）';
      passed = true;
    } else {
      passed = false;
    }
  }
}
```

**关键点：**
- **行为测试比属性检查更可靠**：直接验证"空值时 OK 无法提交"的业务行为，不依赖实现细节
- 点击 OK 后等待 800ms，再检查 Cancel 按钮是否仍可见（弹框未关闭 = 提交被阻止 = ✅ PASS）

---

#### TC-RG-04 / TC-RG-05：无效 RG 名称 — 弹框显示错误提示

```js
await rgNameInput.click({ clickCount: 3 });
await rgNameInput.fill(tc.input);   // e.g. "rg-test." 或 "rg!test"
await rgNameInput.press('Tab');
await page.waitForTimeout(600);
const errText = await getRGDialogError();
// errText 应包含 RG 名称格式规则说明
```

期望错误文本：
> *"Resource group names can only include alphanumeric, underscore, parentheses, hyphen, period (except at end), and Unicode characters that match the allowed characters."*

---

#### TC-RG-VALID：合法 RG 名称 — 点击 OK，弹框关闭

```js
await rgNameInput.click({ clickCount: 3 });
await rgNameInput.fill(VALID_RG_NAME);  // e.g. "lyx-rg-test"
await rgNameInput.press('Tab');
await page.waitForTimeout(600);

const errText = await getRGDialogError();
// errText 应为 null（无错误）

const okBtn = page.getByRole('button', { name: 'OK' }).first();
await okBtn.waitFor({ state: 'visible', timeout: 10000 });
await okBtn.click();

// 验证弹框关闭（Cancel 消失）
const dialogClosed = !(await popupCancelBtn.isVisible({ timeout: 2000 }).catch(() => false));
// 验证 RG 字段已更新为新名称
const rgFieldText = await page.evaluate((name) => {
  for (const el of document.querySelectorAll('[role="combobox"], input, button')) {
    if ((el.value || el.textContent || '').includes(name)) return true;
  }
  return false;
}, VALID_RG_NAME);
```

**关键点：**
- 弹框关闭判据：`popupCancelBtn` 不再可见
- RG 字段更新判据：字段内容中出现新 RG 名称

---

### Step 12：最终合法值验证

所有非法用例测试完成后，输入合法 Name `lyx-stage-0514`，验证字段恢复正常（`aria-invalid` 不为 `"true"`）：

```js
await nameInput.click({ clickCount: 3 });
await nameInput.fill(VALID_NAME);
await page.waitForTimeout(300);
await nameInput.press('Tab');
await page.waitForTimeout(800);

const { ariaInvalid: finalAria, errorText: finalErr } = await getNameErrorMessage(page);
// aria-invalid 是权威来源；TC-01 往返操作后可能残留 stale 错误 DOM 节点，不作为主判据
const validPassed = finalAria !== 'true';
```

**关键点：**
- TC-01 往返 Review + create / Basics 后，Portal DOM 中可能残留旧的错误文本节点（`stale DOM`），即使字段已恢复合法，错误文本也可能仍然存在
- **判断依据只用 `aria-invalid !== 'true'`**，不使用 `!errorText`，避免因残留 DOM 导致误判 FAIL

---

## 预期测试结果

| ID | 输入值 | 预期 `aria-invalid` | 预期错误提示 |
|----|--------|---------------------|------------|
| TC-01 | `""` | `true`（切换标签后） | *The value must not be empty. Only alphanumeric...* |
| TC-02 | 31字符 | `true` | *Only alphanumeric characters are allowed...* |
| TC-03 | `-lyx-test` | `true` | *Only alphanumeric characters are allowed...* |
| TC-04 | `lyx-test-` | `true` | *Only alphanumeric characters are allowed...* |
| TC-05 | `-lyx-test-` | `true` | *Only alphanumeric characters are allowed...* |
| TC-06 | `lyx test` | `true` | *Only alphanumeric characters are allowed...* |
| TC-07 | `lyx_test` | `true` | *Only alphanumeric characters are allowed...* |
| TC-08 | `lyx@test` | `true` | *Only alphanumeric characters are allowed...* |
| TC-09 | `lyx.test` | `true` | *Only alphanumeric characters are allowed...* |
| TC-10 | `lyx#test!` | `true` | *Only alphanumeric characters are allowed...* |
| TC-11 | `中文名称` | `true` | *Only alphanumeric characters are allowed...* |
| TC-RG-01 | （空，Resource Group）| `null`（combobox 无 aria-invalid）| *The value must not be empty.*（经 Review+create 往返后） |
| TC-RG-02 | （"Create new" 可见性） | N/A | 元素可见即通过 |
| TC-RG-03 | `""` （弹框 Name 为空） | N/A | 点击 OK 后弹框不关闭（空值提交被阻止） |
| TC-RG-04 | `rg-test.` | N/A | *Resource group names can only include alphanumeric, underscore, parentheses, hyphen, period (except at end)...* |
| TC-RG-05 | `rg!test` | N/A | *Resource group names can only include alphanumeric, underscore, parentheses, hyphen, period (except at end)...* |
| TC-RG-VALID | `lyx-rg-test` | N/A（弹框关闭验证） | （无错误，弹框关闭，RG 字段更新） |
| FINAL | `lyx-stage-0514` | `false` | （无） |

---

## 截图与报告

每个用例测试完成后自动截图，文件命名格式为 `{ID}-{描述摘要}.png`，存入 `name-validation-screenshots/` 目录。

测试结束后输出 JSON 报告 `name-validation-screenshots/report.json`，格式如下：

```json
{
  "results": [
    {
      "id": "TC-01",
      "description": "空字符串（空白 Name）",
      "input": "",
      "rule": "长度必须 1-30 字符，不能为空",
      "ariaInvalid": "true",
      "errorText": "The value must not be empty. Only alphanumeric...",
      "actualInputLength": 0,
      "passed": true
    },
    // TC-02 ~ TC-11 ...
    {
      "id": "TC-RG-01",
      "description": "Resource Group 空值，Review+create 往返后触发错误",
      "input": "（空）",
      "rule": "Resource Group 不能为空；切换 Review+create 再返回后应提示 \"The value must not be empty.\"",
      "ariaInvalid": null,
      "errorText": "The value must not be empty.",
      "actualInputLength": 0,
      "passed": true
    }
  ],
  "validNameResult": {
    "ariaInvalid": "false",
    "errorText": "",
    "passed": true
  }
}
```

---

## 已知注意事项

| 现象 | 原因 | 处理方式 |
|------|------|---------|
| TC-01 blur 后无错误 | 空值验证是延迟触发（导航时才批量校验） | 切到 Review + create 再切回 Basics 强制触发 |
| 标签名变为 `Basics (1)` | Portal 在切回时标注错误数量 | 用 `/basics/i` 宽松匹配标签 |
| 合法值后仍有 errorText | TC-01 往返产生的 stale DOM 节点 | 只以 `aria-invalid !== 'true'` 作为通过判据 |
| TC-02 实际长度为 31 | input 元素无 `maxlength` 限制，允许填入 31 字符 | 脚本记录实际填入长度便于诊断 |
| TC-RG-01 `aria-invalid` 为 `null` | Resource Group combobox 无标准 `label[for]` 关联，无法从控件本身读取 `aria-invalid`；错误状态通过文本匹配判定 | 判定依据改为检测 `errorText` 是否包含 *"The value must not be empty."* |
| "Create new" 弹框无 `role="dialog"` | 弹框是 inline callout，非模态对话框 | 改用弹框内 Cancel 按钮作为弹框出现/关闭的检测锚点 |
| 弹框 OK 按钮视觉禁用但无 `disabled` 属性 | Fluent UI 使用纯 CSS 控制视觉禁用，无 `disabled`/`aria-disabled`/`pointer-events:none`/`opacity` 等标准属性，`className` 中也无 "disabled" | 改用**行为测试**：点击 OK 后检查 Cancel 是否仍可见；弹框未关闭 = 提交被阻止 = ✅ PASS |
| `page.evaluate()` 在 iframe 内执行于主框架 | Azure Portal 部分 UI（包括"Create new"弹框）运行在 `<iframe>` 内，`page.evaluate()` 只在主框架执行，无法访问弹框 DOM | 改用 `locator.evaluate()` — 回调在 locator 所在 frame 中执行，可访问 iframe 内 DOM |
| XPath 从 locator 开始才能跨 frame | `page.locator('xpath=...')` 在主框架查找 XPath | 用 `popupCancelBtn.locator('xpath=ancestor::*[.//input][1]//input')` 保证 XPath 在 Cancel 所在 frame 内执行 |

---

## SC4 Tags Tab 测试关键点

测试脚本：`test-nginxaas-name-validation.js`（运行参数：`--sc4`）  
函数入口：`runSC4TagsTest(page)`

### 用例设计

| ID | 操作 | 预期结果 |
|----|------|---------|
| TC-TAG-01 | 添加 `env=test` | 标签提交为 display row，grid 中可见 |
| TC-TAG-02 | 添加 `owner=lyx` | 同上 |
| TC-TAG-03 | 添加 `project-name=nginx/stage`（值含 `/`）| 正常添加，特殊字符 `/` 在值中被允许 |
| TC-TAG-04 | 添加 `cost_center=123`（键含 `_`）| 正常添加，`_` 在键中被允许 |
| TC-TAG-05 | 添加 `env=production`（与 TC-01 键名重复）| 出现错误 *"Invalid tag name. The tag name 'env' is already used. Tag names are case-insensitive."* |
| TC-TAG-SPECIAL | 在 Name 中输入 `<>?` | 出现错误 *"The following characters are not supported: <>%&\?/."* |
| TC-TAG-EDIT | 编辑 `owner` 的值：lyx → yixueli | display row 更新，显示新值 yixueli |
| TC-TAG-DEL | 删除 `cost_center` 行 | grid 中 cost_center 行消失 |
| TC-TAG-REVIEW | 进入 Review+Create，验证字段摘要 | 无错误 banner；subscription/rg/name/region/plan 字段正确；tags 摘要含 env/owner/project-name，不含 cost_center |

---

### Tags Grid 关键行为

**1. Name 输入框受 Knockout.js 绑定，必须用 `pressSequentially`**

- `fill()` 和 `keyboard.type()` 均会被 KO observable 重置
- 必须用 `pressSequentially(key, { delay: 80 })` 触发真实按键事件，KO 才能正确捕获输入
- 此规则**仅适用于 Name 输入框**；Value 输入框可用 `keyboard.type()` 正常输入

**2. 从 Name 导航到 Value 必须用 Tab，不能用 click**

- 在 Name 中完成输入后，`page.keyboard.press('Tab')` 移到 Value
- 若直接 `click()` Value 输入框（通过 ID），KO 可能在 Tab 前重渲染，导致 ID 失效或行内容被覆盖

**3. autocomplete 下拉可能阻塞 Tab 行为**

- Name combobox 有自动补全下拉框（显示现有标签名），`Tab` 在下拉打开时可能导航到下拉选项而非 Value
- 确认已按 Escape 关闭下拉（不影响已输入的 KO observable value），再按 Tab
- 等待时间建议：`pressSequentially` 后 wait 350ms，再按 Tab

**4. 提交（commit）editing row**

- 按 Tab 离开 Value 后行不一定立即提交；Portal 还有 Resource 列下拉框
- 最可靠的提交方式：**点击下一行的 Name 输入框**（空编辑行），迫使当前行失焦并提交
- 切换到其他 wizard 标签页再切回**不会清除**未提交的编辑行

**5. display row 与 editing row 的区分**

- 已提交的标签以纯文本"overlay"显示（display row），DOM 中**无 input 元素**
- `tagsPanel.querySelectorAll('input[aria-label="Name"]')` 只返回当前 editing row 的输入框
- 点击任意 display row 会将其置为 editing mode（出现 input），其他行不受影响

**6. Delete 按钮定位**

- Delete 按钮无 `aria-label="Delete"` HTML 属性；`querySelectorAll('button[aria-label="Delete"]')` 返回 0
- 可访问名称通过无障碍树（img alt text）计算而来，需用 Playwright 无障碍 API：
  ```js
  // 按行内容找到对应 Delete 按钮（最可靠）
  rows.nth(costCenterRowIdx).getByRole('button', { name: 'Delete' }).click()
  ```
- 也可按 index 定位：4 个 display row 的 Delete 按钮 index 为 0–3，额外的 editing row 的 Delete 为 index 4+

**7. Review+Create 验证方式**

- 通过 `page.getByRole('button', { name: 'Review + create' }).click()` 导航（非点击 tab）
- 验证方式：读取 `page.getByRole('tabpanel', { name: 'Review + create' }).innerText()`，检查各字段文本是否出现
- 无错误判断：检查 `page.locator('[role="alert"]').innerText()` 不含 `error/failed/invalid`

---

### 特殊字符 `<>?` 验证说明

- 实际错误文本：**`The following characters are not supported: <>%&\?/.`**
- 需在 Name 输入 `<>?` 并按 Tab 触发验证后才出现（仅输入不按 Tab 时错误不出现）
- 检测 regex：`/not supported|invalid tag name/i`

---

## SC3：选择现有 Undersized/未委托 VNet 校验测试

测试脚本：`test-nginxaas-name-validation.js`（运行参数：`--sc3`）  
截图目录：`sc4-screenshots/`  
目标 VNet：`lyx-vnet01`（过小 /28 或未委托给 NGINXaaS 的子网）

### 测试场景

在 NGINXaaS Create 向导的 **Networking** 页面，将 Virtual network 切换为现有的 `lyx-vnet01`，并选择其 `default` 子网，然后点击 Next。验证 Azure Portal 是否显示对应的拒绝/校验错误（委托不足、子网过小等）。

### 用例设计

| 步骤 | 操作 | 预期结果 |
|------|------|---------|
| Basics | Subscription = Liftr-Nginx-Test, RG = lyx-liftr-test, Region = West Central US, Pricing = Standard V3 | Basics 无错误，可点击 Next |
| Networking | 点击 VNet 下拉控件（显示"(New) ..."），切换到现有 lyx-vnet01 | VNet 字段更新为 lyx-vnet01 |
| Networking | 点击 subnet 下拉控件，选择 default | subnet 字段更新 |
| 校验 | 点击 Next | 页面留在 Networking，出现委托/子网过小相关错误提示 |

### 关键实现点

**1. Region 下拉选择**

Basics 页 Region 字段默认为 East US，需切换为 West Central US：

- 点击 `.fxc-dropdown-open.azc-input` 的第 3 个（`nth(2)`，0-based，顺序：Subscription、RG、Region）
- 输入 `West Central` 到过滤框（通过 `keyboard.type` 触发，过滤框会自动获焦）
- 遍历所有 `.fxc-dropdown-option` 元素，找到 `isVisible()` 为 true 且文本匹配 `/west central us/i` 的项，点击

```js
const allOpts = await page.locator('.fxc-dropdown-option').all();
for (const opt of allOpts) {
  const visible = await opt.isVisible().catch(() => false);
  if (!visible) continue;
  const text = (await opt.textContent().catch(() => '')) || '';
  if (/west central us/i.test(text)) { await opt.click(); break; }
}
```

**2. VNet/subnet 下拉触发（绕过 position:absolute 可见性问题）**

Networking 页的 VNet 和 subnet 控件（`.fxc-dropdown-open.azc-input`）使用 `position: absolute`，Playwright 的 `waitFor({ state: 'visible' })` 无法检测到它们。

解决方案：用 `evaluateHandle` 在 JS 侧通过 `getBoundingClientRect` 找到有布局的元素，绕过 Playwright 可见性检查：

```js
const dropdownHandle = await page.evaluateHandle((idx) => {
  const all = [...document.querySelectorAll('.fxc-dropdown-open.azc-input, .fxc-dropdown-open')];
  const withContent = all.filter((el) => {
    const rect = el.getBoundingClientRect();
    return (rect.width > 0 || rect.height > 0) && (el.textContent || '').trim().length > 0;
  });
  return withContent[idx] || null;
}, index);
const dropdownEl = dropdownHandle.asElement();
await dropdownEl.click();
```

- `index=0`：Virtual network 下拉（显示 "(New) lyx-sc3-..." ）
- `index=1`：subnet 下拉（显示 "(New) default"），在 VNet 选定后等待 2s 再操作

**3. 下拉选项定位（`.fxc-dropdown-option` vs `[role="option"]`）**

与 Region 相同，用 `.fxc-dropdown-option` 遍历 + `isVisible()` 检查：

- `[role="option"]` 会匹配到 Azure Portal 全局搜索历史（`fxs-search-menu-content`）中始终存在的隐藏元素，导致 `waitFor({ state: 'visible' })` 永远超时
- `.fxc-dropdown-option` 是 Azure Portal Fluent/FxC 下拉控件的专用 CSS 类，不受全局搜索历史干扰

**4. 校验结果判断**

点击 Next 后，通过以下条件判断 Portal 是否拒绝选择：

```js
const matched = errors.some((text) =>
  /delegat|subnet|\/27|address space|size|not valid|validation failed/i.test(text)
);
```

关键词：`delegat`（委托缺失）、`subnet`、`/27`（子网大小不足）、`address space`、`validation failed`。

**5. XPath 定位 Networking checkbox**

Networking 页控制 "Virtual Network Access" 区域展开的 checkbox/span 元素使用绝对 XPath：

```
/html/body/div[1]/div[4]/div[1]/div[1]/main/div[3]/div[2]/section[2]/div[2]/div[1]/div[4]/div[2]/div/div/div[2]/div/div[2]/div[2]/div/div[2]/div/div[3]/div[3]/div[2]/div[2]/div/div/span
```

通过 `page.locator('xpath=...')` 定位后调用 `.click()` 展开 VNet 配置区域。

### 预期测试结果

| 测试点 | 预期 |
|--------|------|
| Basics 填写（含 Region = West Central US） | ✅ 无错误，可前进 |
| VNet 下拉切换为 lyx-vnet01 | ✅ 字段更新 |
| subnet 下拉选择 default | ✅ 字段更新 |
| 点击 Next 后校验 | ✅ 出现委托/子网大小相关错误，停留在 Networking 页 |

### 已知注意事项

| 现象 | 原因 | 处理方式 |
|------|------|---------|
| `[role="option"]` 匹配到搜索历史隐藏项 | Azure Portal 将 portal-level 搜索历史 `<a>` 赋予 `role="option"` 和 `id="West central us"` | 改用 `.fxc-dropdown-option` 类遍历 |
| VNet/subnet 控件 `waitFor visible` 超时 | 控件是 `position: absolute` 元素，Playwright 基于布局流检测可见性无法识别 | 用 `evaluateHandle` 通过 `getBoundingClientRect` 检查布局 |
| `.fxc-dropdown-popup-dock.last()` 报 hidden | 多个 dropdown 共享同类容器，`.last()` 取到其他（仍关闭的）popup-dock | 不依赖 popup-dock 容器；直接在全页遍历 `.fxc-dropdown-option` |
| Subscription 下拉顺序干扰 Region 定位 | Basics 页所有 `.fxc-dropdown-open.azc-input` 顺序：Subscription(0)、RG(1)、Region(2) | 用 `.nth(2)` 直接定位 Region，不用 `.first()` |
