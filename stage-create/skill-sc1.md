# SC1 – Service Discovery 自动化测试 Skill

## 测试目标

验证在 Azure Portal 中搜索 `NGINXaaS` 并点击 **+ Create** 后，Create 向导默认打开在 **Basics** 标签页。

---

## 环境要求

| 依赖 | 说明 |
|------|------|
| Playwright MCP 浏览器 | 使用 `mcp_microsoft_pla_browser_*` 工具集 |
| Azure Portal 账号 | 需提前在浏览器中完成 Microsoft 账号登录 |

---

## 测试目标 URL

```
https://portal.azure.com/?feature.customportal=false
  &feature.canmodifystamps=true
  &Azure_Marketplace_Nginx=stage1
  &microsoft_azure_marketplace_ItemHideKey=Azure_Marketplace_NGINX
  #home
```

---

## 执行步骤与关键点

### Step 1：导航到 Azure Portal

使用 `mcp_microsoft_pla_browser_navigate` 导航至上方 URL。

**关键点：**
- 若跳转到登录页，使用 `mcp_microsoft_pla_browser_click` 点击账号选择器中对应的账号 tile（`text=账号名`）完成 SSO 登录。
- 登录后再次导航到 Azure Portal URL，等待页面 title 变为 `Home - Microsoft Azure`。

---

### Step 2：搜索 NGINXaaS

使用 `mcp_microsoft_pla_browser_run_code_unsafe` 执行以下代码：

```js
async (page) => {
  const searchInput = page.locator('input[placeholder*="Search"]').first();
  await searchInput.click({ clickCount: 3 });
  await searchInput.pressSequentially('nginxaas', { delay: 80 });
  await page.waitForSelector('[role="listbox"] [role="option"]', { timeout: 10000 });
  return 'Search results appeared';
}
```

**关键点：**
- **必须使用 `pressSequentially` 而非 `fill`**：`fill` 直接设置 value，不触发 Portal 的搜索事件，导致下拉列表不出现。
- `click({ clickCount: 3 })` 先全选输入框内容再覆盖，避免残留上次搜索词。
- `delay: 80` 模拟人工逐键输入，确保每个字符都触发事件处理器。
- 等待 `[role="listbox"] [role="option"]` 出现，作为搜索结果已渲染的可靠信号。

---

### Step 3：点击 NGINXaaS（Services 分类）

```js
async (page) => {
  await page.locator('[role="option"]').filter({ hasText: /^NGINXaaS$/ }).first().click();
  await page.waitForSelector('iframe[name="BrowseResource.ReactView"]', { timeout: 30000 });
  return 'Resource list page loaded';
}
```

**关键点：**
- 搜索结果分为 **Services**、**Marketplace**、**Documentation** 三类，必须精确点击 Services 下的 `NGINXaaS`。
- 使用 `/^NGINXaaS$/` 正则精确匹配，避免误点 `F5 NGINXaaS – SaaS Load Balancer...` 等 Marketplace 条目。
- 等待 `iframe[name="BrowseResource.ReactView"]` 出现，作为资源列表页已加载的可靠信号。
- **不能使用 `waitForURL`**：Portal 路由基于 hash（`#browse/...`），`waitForURL` 无法检测 hash 变化。

---

### Step 4：点击 + Create 按钮

```js
async (page) => {
  await page.waitForTimeout(3000); // 等待 iframe 内容完全渲染
  const createBtn = page
    .frameLocator('iframe[name="BrowseResource.ReactView"]')
    .locator('[role="menuitem"]:has-text("Create")');
  await createBtn.waitFor({ state: 'visible', timeout: 30000 });
  await createBtn.click();
  await page.waitForURL(/create\/f5-networks/i, { timeout: 30000 });
  await page.waitForTimeout(4000); // 等待表单控件完全渲染
  return 'Create wizard opened';
}
```

**关键点：**
- Create 按钮位于 `BrowseResource.ReactView` iframe 内，**必须用 `frameLocator()` 穿透 iframe**，直接在 page 上查找会失败。
- iframe 出现后需额外等待 3 秒，确保内部 React 组件渲染完毕后再查找 Create 按钮。
- 点击 Create 后的页面跳转属于完整 URL 跳转（非 hash 内跳转），`waitForURL(/create\/f5-networks/i)` 可正常检测。
- 进入创建页面后再等待 4 秒，确保 Marketplace 表单控件完全加载。

---

### Step 5：验证 Basics 标签页为活跃状态

```js
async (page) => {
  const tabs = page.locator('[role="tab"], .fxc-wizard-step, li.msportalfx-wizard-step');
  const count = await tabs.count();

  const tabResults = [];
  for (let i = 0; i < count; i++) {
    const t = tabs.nth(i);
    tabResults.push({
      text: (await t.textContent().catch(() => '')).trim(),
      ariaSel: await t.getAttribute('aria-selected').catch(() => null),
      cls: (await t.getAttribute('class').catch(() => '') || '').substring(0, 80)
    });
  }

  const projectDetailsVisible = await page.locator('text=Project details').isVisible().catch(() => false);
  const url = page.url();
  return JSON.stringify({ tabs: tabResults, projectDetailsVisible, url });
}
```

**关键点：**
- Basics 标签激活态的判断依据：`aria-selected="true"` 且 class 中包含 `azc-br-active`。
- 同时检查页面中 `"Project details"` 文本可见，作为 Basics 表单内容已渲染的内容信号。
- 预期 URL 为 `#create/f5-networks.f5-nginx-for-azure`。
- 标签文本在 DOM 中会重复（如 `"BasicsBasics"`），这是 Portal 的正常行为，不影响判断。

---

## 通过标准（Pass Criteria）

| 验证项 | 预期结果 |
|--------|----------|
| 搜索结果下拉中出现 NGINXaaS（Services 分类） | 出现 `[role="option"]` 且文本精确匹配 `NGINXaaS` |
| 点击后进入资源列表页 | `iframe[name="BrowseResource.ReactView"]` 可见 |
| 点击 + Create 后 URL 跳转 | URL 匹配 `/create\/f5-networks/i` |
| Basics 标签为选中状态 | `aria-selected="true"` + class 含 `azc-br-active` |
| Basics 表单内容已渲染 | `"Project details"` 文本在页面中可见 |

---

## 已知注意事项

- 使用 `mcp_microsoft_pla_browser_press_key` 单键输入无法可靠地触发 Portal 搜索事件，**必须改用 `mcp_microsoft_pla_browser_run_code_unsafe` 调用 `pressSequentially`**。
- `mcp_microsoft_pla_browser_click` 的 `target` 若匹配到多个元素会报 strict mode violation，应优先在 `run_code_unsafe` 中使用 `.filter({ hasText: /^精确文本$/ })` 缩小范围。
- `open_browser_page` 工具会开启全新浏览器上下文，**不共享** `mcp_microsoft_pla_browser_*` 的已登录会话，两套工具不可混用。

---

---

# SC2 – Basics Field Validation 自动化测试 Skill

## 测试目标

验证 Create NGINXaaS 向导 Basics 页面所有字段的即时校验逻辑，包括：空必填字段、Name 非法字符、重复名称、Email 格式、Pricing Plan 可选项、Manual/Autoscale 切换及 NCU 非法值。

---

## 前置条件

SC2 在 SC1 完成后续接执行，浏览器已打开在 `#create/f5-networks.f5-nginx-for-azure`，Basics 标签页处于激活状态。如浏览器已关闭，需重新执行 SC1 步骤进入 Create 向导。

---

## Sub-test A：空必填字段触发全局校验

```js
async (page) => {
  // 直接点击 Review + create（所有必填字段均为空）
  const reviewBtn = page.locator('[role="button"]:has-text("Review + create")').last();
  await reviewBtn.scrollIntoViewIfNeeded();
  await reviewBtn.click();
  await page.waitForTimeout(2000);
  // 采集所有可见错误消息
  const errors = await page.evaluate(() => {
    const sels = [
      '.azc-formElementError', '[class*="validationError"]',
      '[class*="errorMessage"]', '.fxc-base-error',
      '[aria-live="polite"]', '[role="alert"]'
    ];
    const msgs = new Set();
    sels.forEach(sel => {
      document.querySelectorAll(sel).forEach(el => {
        const t = el.textContent?.trim();
        if (t && t.length > 2 && t.length < 400) msgs.add(t);
      });
    });
    return [...msgs];
  });
  return JSON.stringify({ errors });
}
```

**关键点：**
- Review + create 在向导中是 `[role="button"]` 的 `DIV` 元素，**不是 `<button>` 标签**，用 `button:has-text(...)` 会超时。
- 使用 `.last()` 选取最后一个匹配项，对应页脚操作区的按钮。
- 触发后保留在当前 URL（不跳转），页面出现全局 banner `"Validation failed. Required information is missing or not valid."`，Basics 和 Networking 标签均显示红色 ✗。

---

## Sub-test B：Name 字段非法值逐项验证

```js
async (page) => {
  // 返回 Basics 标签
  await page.getByRole('tab', { name: /basics/i }).first().click();
  await page.waitForTimeout(1500);

  // 三级错误读取策略（来自 SKILL-name-validation.md）
  async function getNameError(page) {
    return page.evaluate(() => {
      const label = [...document.querySelectorAll('label')]
        .find(l => /^Name\b/.test((l.textContent || '').trim()));
      const input = document.getElementById(label?.htmlFor);
      if (!input) return { ariaInvalid: null, errorText: 'not found' };
      const ariaInvalid = input.getAttribute('aria-invalid');
      let container = input.parentElement;
      for (let d = 0; d < 8 && container; d++, container = container.parentElement) {
        const errId = input.getAttribute('aria-errormessage') || input.getAttribute('aria-describedby');
        if (errId) {
          const el = document.getElementById(errId.split(' ')[0]);
          const t = (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
          if (t) return { ariaInvalid, errorText: t };
        }
        for (const el of container.querySelectorAll('[role="alert"], [aria-live]')) {
          const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
          if (t) return { ariaInvalid, errorText: t };
        }
        for (const el of container.querySelectorAll('[class*="error"], [class*="invalid"]')) {
          const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
          if (t) return { ariaInvalid, errorText: t };
        }
      }
      return { ariaInvalid, errorText: null };
    });
  }

  // Name 输入框 ID（实测固定为 form-label-id-0-for）
  const nameInput = page.locator('[id="form-label-id-0-for"]');

  const cases = [
    { id: 'TC-03', val: '-lyx-test',     desc: '开头连字符' },
    { id: 'TC-04', val: 'lyx-test-',     desc: '结尾连字符' },
    { id: 'TC-06', val: 'lyx test',      desc: '含空格' },
    { id: 'TC-07', val: 'lyx_test',      desc: '含下划线' },
    { id: 'TC-08', val: 'lyx@test',      desc: '含 @' },
    { id: 'TC-11', val: '中文名称',       desc: '非 ASCII' },
    { id: 'TC-02', val: 'a'.repeat(31),  desc: '31 个字符（超长）' },
    { id: 'DUP',   val: 'lyx-stage-0519', desc: '重复名称' },
  ];

  const results = [];
  for (const tc of cases) {
    await nameInput.click({ clickCount: 3 });
    await nameInput.fill(tc.val);
    await nameInput.press('Tab');
    await page.waitForTimeout(800);
    const { ariaInvalid, errorText } = await getNameError(page);
    results.push({ id: tc.id, ariaInvalid, errorText: (errorText || '').substring(0, 120) });
  }
  return JSON.stringify(results, null, 2);
}
```

**关键点：**
- Name 输入框 ID 实测为 `form-label-id-0-for`，可硬编码（仍建议用 `label.htmlFor` 动态读取以应对版本变化）。
- `fill()` + `Tab` 即可触发 blur 即时校验；非法字符输入后 `aria-invalid="true"` 且出现错误文本。
- **重复名称（DUP）的 inline 校验不触发**：`aria-invalid="false"`，无错误提示——这是预期行为，重复检测在服务端提交时发生。
- 空值（TC-01）的 blur 不触发 inline 错误，需经 Review+create → 切回 Basics 的往返触发（参见 SKILL-name-validation.md Step 11）。

---

## Sub-test C：Email 字段非法格式验证

```js
async (page) => {
  // Email 输入框 ID 实测为 form-label-id-4-for
  const emailInput = page.locator('[id="form-label-id-4-for"]');

  const cases = [
    { val: 'notanemail',    desc: '无 @ 符号' },
    { val: 'test@',         desc: '无域名' },
    { val: '@nodomain.com', desc: '无本地部分' },
    { val: 'test@test',     desc: '无 TLD' },
    { val: '',              desc: '空值（选填字段）' },
  ];

  const results = [];
  for (const tc of cases) {
    await emailInput.click({ clickCount: 3 });
    tc.val === '' ? await emailInput.press('Delete') : await emailInput.fill(tc.val);
    await emailInput.press('Tab');
    await page.waitForTimeout(700);
    // 复用 getFieldError 策略（与 Name 相同的三级读取）
    const state = await page.evaluate(() => {
      const input = document.getElementById('form-label-id-4-for');
      return { ariaInvalid: input?.getAttribute('aria-invalid'), value: input?.value };
    });
    results.push({ val: tc.val, desc: tc.desc, ...state });
  }
  return JSON.stringify(results, null, 2);
}
```

**关键点：**
- 非法 email 格式（`notanemail`、`test@`、`@nodomain.com`、`test@test`）均触发 `aria-invalid="true"` + `"Please enter a valid email address."`。
- **Email 为选填字段**：空值时 `aria-invalid="false"`，不报错。
- `press('Delete')` 用于清空字段（比 `fill('')` 在某些 Portal 控件中更可靠）。

---

## Sub-test D：Pricing Plan 选择

```js
async (page) => {
  // "Select pricing plan" 是 SPAN[role="button"]，不是 <a> 也不是 [role="link"]
  await page.locator('[role="button"]:has-text("Select pricing plan")').first().click();
  await page.waitForTimeout(3000); // ⚠ 必须等待 ≥ 2.5 秒：计划 radio 动态加载
  // 此时打开 Marketplace Plans 面板（page title 变为 "Marketplace Plans - Microsoft Azure"）
  // 读取所有计划的 radio value 和文本
  const plans = await page.evaluate(() => {
    return [...document.querySelectorAll('input[type="radio"]')]
      .map(r => {
        const row = r.closest('tr');
        return row ? { val: r.value, text: row.textContent?.trim().substring(0, 60) } : null;
      })
      .filter(Boolean);
  });
  return JSON.stringify(plans);
}
```

**选择计划并确认：**

```js
async (page) => {
  // 找到目标计划对应的 radio（通过 tr 行文本匹配）
  const allRadios = page.locator('input[type="radio"]');
  const count = await allRadios.count();
  for (let i = 12; i < count; i++) {
    const rowText = await allRadios.nth(i).evaluate(el =>
      el.closest('tr')?.textContent?.substring(0, 40) || ''
    );
    if (rowText.includes('Developer Test')) {
      await allRadios.nth(i).click();
      break;
    }
  }
  await page.waitForTimeout(800);
  await page.locator('[role="button"]:has-text("Confirm Plan")').first().click();
  await page.waitForTimeout(2000);
}
```

**关键点：**
- Marketplace Plans 面板中计划列表的 radio 元素位于 `<tr>` 行内，使用 `el.closest('tr')?.textContent` 匹配目标计划名称。
- 计划 radio 从索引 12 开始（0–11 为 Basics 表单自身的 radio，如 Manual/Autoscale、Public/Private IP 等）。
- 选定后需点击 `[role="button"]:has-text("Confirm Plan")` 确认，面板关闭后 Basics 页面的 Pricing Plan 字段更新。
- stage1 环境可用计划（实测 8 个）：Standard V2 Test、Developer Test、Basic test (private)、Standard V3 Test、Developer、Standard V3、Standard V2 (deprecated)、Basic (deprecated)。

---

## Sub-test E：Manual / Autoscale 切换 + NCU 非法值验证

### E-1：Manual 模式 NCU Capacity 验证

**字段 ID**：`form-label-id-3-for`（label: "NCU Capacity"）

```js
async (page) => {
  const manualItem = page.locator('li.azc-optionPicker-item').filter({ hasText: /^Manual$/ });
  await manualItem.click();
  await page.waitForTimeout(800);

  const ncuInput = page.locator('[id="form-label-id-3-for"]');
  const cases = [
    { val: '0',  desc: 'NCU = 0 (< 10)',      expectInvalid: true },
    { val: '5',  desc: 'NCU = 5（非 10 倍数）', expectInvalid: true },
    { val: '15', desc: 'NCU = 15（非 10 倍数）',expectInvalid: true },
    { val: '10', desc: 'NCU = 10（合法最小值）', expectInvalid: false },
    { val: '20', desc: 'NCU = 20（合法值）',     expectInvalid: false },
  ];
  // 使用三级错误读取策略（见 SKILL-name-validation.md）
  for (const tc of cases) {
    await ncuInput.click({ clickCount: 3 });
    await ncuInput.fill(tc.val);
    await ncuInput.press('Tab');
    await page.waitForTimeout(600);
    // 读取 ariaInvalid + errorText ...
  }
}
```

**Manual NCU 错误消息**：
| 输入值 | ariaInvalid | 错误消息 |
|--------|-------------|---------|
| 0      | true        | "Please enter a value greater than or equal to 10." |
| 5      | true        | "Value must be divisible by 10." |
| 15     | true        | "Value must be divisible by 10." |
| 10     | false       | —（合法） |
| 20     | false       | —（合法） |

---

### E-2：Autoscale 模式 Min / Max NCU 验证

切换到 Autoscale 后，表单新增两个字段：

| 字段名 | ID | 最小约束 |
|-------|----|---------|
| Minimum NGINX Capacity Units | `form-label-id-1-for` | ≥ 10，10 的倍数 |
| Maximum NGINX Capacity Units | `form-label-id-2-for` | ≥ 20，10 的倍数，且必须 > Min |

```js
async (page) => {
  const autoscaleItem = page.locator('li.azc-optionPicker-item').filter({ hasText: /^Autoscale$/ });
  await autoscaleItem.click();
  await page.waitForTimeout(1200);

  const MIN_ID = 'form-label-id-1-for';
  const MAX_ID = 'form-label-id-2-for';

  async function fillAndCheck(page, inputId, val) {
    const inp = page.locator(`[id="${inputId}"]`);
    await inp.click({ clickCount: 3 });
    val === '' ? await inp.press('Delete') : await inp.fill(val);
    await inp.press('Tab');
    await page.waitForTimeout(600);
    return page.evaluate((id) => {
      const input = document.getElementById(id);
      if (!input) return { ariaInvalid: null, errorText: 'not found' };
      const ariaInvalid = input.getAttribute('aria-invalid');
      let c = input.parentElement;
      for (let d = 0; d < 8 && c; d++, c = c.parentElement) {
        const errId = input.getAttribute('aria-errormessage') || input.getAttribute('aria-describedby');
        if (errId) {
          const el = document.getElementById(errId.split(' ')[0]);
          const t = (el?.innerText || el?.textContent || '').replace(/\s+/g, ' ').trim();
          if (t) return { ariaInvalid, errorText: t };
        }
        for (const el of c.querySelectorAll('[role="alert"],[aria-live]')) {
          const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
          if (t) return { ariaInvalid, errorText: t };
        }
        for (const el of c.querySelectorAll('[class*="error"],[class*="invalid"]')) {
          const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
          if (t) return { ariaInvalid, errorText: t };
        }
      }
      return { ariaInvalid, errorText: null };
    }, inputId);
  }

  // -- Min NCU 测试 --
  const minCases = [
    { val: '',   expectInvalid: true },   // 空值
    { val: '0',  expectInvalid: true },   // 0 < 10
    { val: '5',  expectInvalid: true },   // 非10倍数
    { val: '15', expectInvalid: true },   // 非10倍数
    { val: '10', expectInvalid: false },  // 合法最小值
    { val: '20', expectInvalid: false },  // 合法值
  ];
  for (const tc of minCases) {
    const r = await fillAndCheck(page, MIN_ID, tc.val);
    // r.ariaInvalid 应等于 tc.expectInvalid ? 'true' : 'false'
  }

  // -- Max NCU 测试（先将 Min 设为合法值 10）--
  await fillAndCheck(page, MIN_ID, '10');
  const maxCases = [
    { val: '',   expectInvalid: true },   // 空值
    { val: '0',  expectInvalid: true },   // 0 < 20
    { val: '5',  expectInvalid: true },   // 非10倍数
    { val: '10', expectInvalid: true },   // < 20 最小要求
    { val: '15', expectInvalid: true },   // 非10倍数
    { val: '20', expectInvalid: false },  // 合法最小值
    { val: '30', expectInvalid: false },  // 合法值
  ];
  for (const tc of maxCases) {
    const r = await fillAndCheck(page, MAX_ID, tc.val);
  }

  // -- Max < Min 交叉校验（min=30, max=20）--
  await fillAndCheck(page, MIN_ID, '30');
  const crossCheck = await fillAndCheck(page, MAX_ID, '20');
  // 预期: ariaInvalid=true, "Must be greater than minimum NGINX Capacity Units"
}
```

**Min NCU（`form-label-id-1-for`）错误消息**：
| 输入值 | ariaInvalid | 错误消息 |
|--------|-------------|---------|
| 空     | true        | "Must be greater than or equal to 10" |
| 0      | true        | "Must be greater than or equal to 10" |
| 5      | true        | "Must be greater than or equal to 10 Value must be divisible by 10." |
| 15     | true        | "Value must be divisible by 10." |
| 10     | false       | — |
| 20     | false       | — |

**Max NCU（`form-label-id-2-for`，Min=10 时）错误消息**：
| 输入值 | ariaInvalid | 错误消息 |
|--------|-------------|---------|
| 空     | true        | "Must be greater than or equal to 20" |
| 0      | true        | "Must be greater than or equal to 20 Must be greater than minimum NGINX..." |
| 5      | true        | "Must be greater than or equal to 20 Must be greater than minimum NGINX..." |
| 10     | true        | "Must be greater than or equal to 20 Must be greater than minimum NGINX..." |
| 15     | true        | "Must be greater than or equal to 20 Value must be divisible by 10." |
| 20     | false       | — |
| 30     | false       | — |

**Max < Min 交叉校验**：当 Max(20) < Min(30) 时，Max 字段报 `"Must be greater than minimum NGINX Capacity Units"`。

**关键点：**
- 缩放模式切换用 **`li.azc-optionPicker-item`** LI 包装元素，原生 `input[value="autoscale"]` 有 `aria-hidden="true"`，**直接 click input 会超时**。
- Autoscale 模式下 Manual 的 NCU Capacity (`form-label-id-3-for`) 字段仍在 DOM 中，但被隐藏，不参与校验。
- Min NCU 字段 ID：`form-label-id-1-for`；Max NCU 字段 ID：`form-label-id-2-for`（在 Autoscale 模式下出现）。
- Min 值 = 0 时错误只显示 "Must be >= 10"（不显示 divisible by 10），Min 值 = 5 时同时显示两条。

---

## Autoscale 在 Developer 计划的行为说明

| 阶段 | 行为 |
|------|------|
| **Create 向导** | Autoscale 选项 `aria-disabled="false"`，可正常点击选中（stage1 计划未在 UI 层禁用） |
| **部署完成后管理界面** | Autoscale 功能无数据显示，实际处于禁用状态 |

> **结论**：Developer 计划的 Autoscale 限制属于**运行时禁用**，在创建向导阶段不拦截，验证点应在部署后管理界面（SC7）确认。

---

## 通过标准（Pass Criteria）

| 验证项 | 预期结果 |
|--------|----------|
| 点击 Review+create（全空） | 全局 banner 出现 + Basics/Networking 标签显示红 ✗ |
| Name 非法字符（TC-03～TC-11, TC-02） | 每项 `aria-invalid="true"` + 出现 "Only alphanumeric..." 提示 |
| Name 重复值（DUP） | `aria-invalid="false"`，无 inline 错误（服务端校验） |
| Email 非法格式 | `aria-invalid="true"` + "Please enter a valid email address." |
| Email 空值 | `aria-invalid="false"`（选填字段，空值合法） |
| Pricing Plan 面板 | 打开 Marketplace Plans 面板，展示所有可用计划 |
| NCU = 0 | `aria-invalid="true"` + "Please enter a value greater than or equal to 10." |
| NCU 非 10 倍数（5、15） | `aria-invalid="true"` + "Value must be divisible by 10." |
| NCU = 10/20（合法） | `aria-invalid="false"` |
| Autoscale → Min NCU 空/0/非倍数 | `aria-invalid="true"` + "Must be greater than or equal to 10" |
| Autoscale → Max NCU 空/0/< 20 | `aria-invalid="true"` + "Must be greater than or equal to 20" |
| Autoscale → Max NCU 非 10 倍数 | `aria-invalid="true"` + "Value must be divisible by 10." |
| Autoscale → Max < Min | `aria-invalid="true"` + "Must be greater than minimum NGINX Capacity Units" |
| Autoscale → Min=10, Max=20（合法） | 两字段均 `aria-invalid="false"` |
