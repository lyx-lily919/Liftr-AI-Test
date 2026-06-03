# NGINXaaS Create 向导完整测试 Skill（SC1 → SC2 → SC3 → SC4）

## 概述

本 Skill 使用 **MCP Playwright Browser 工具**（`mcp_microsoft_pla_browser_*`）对 Azure Portal 中 NGINXaaS Create 向导执行全流程测试：

| 场景 | 覆盖范围 |
|------|---------|
| SC1 Service Discovery | 搜索 NGINXaaS → 点击 +Create → 验证 Basics 标签激活 |
| SC2 Basics 字段验证 | Name 非法值（11 个 TC）+ Resource Group 验证（TC-RG-01~VALID） |
| SC3 Networking 配置验证 | 默认 VNet/子网、公共 IP 选项、Private Only、端口、现有 VNet、无效 VNet 拒绝 |
| SC4 Tags 验证 | 添加/重复/特殊字符/编辑/删除标签 + Review+Create 摘要 |

所有场景在同一浏览器页面中**顺序执行**，无需断开。每个步骤的通过/失败记录在本地 `results` 数组中，最终打印汇总表格。

---

## 使用的工具

| 工具 | 用途 |
|------|------|
| `mcp_microsoft_pla_browser_navigate` | 导航到 URL |
| `mcp_microsoft_pla_browser_snapshot` | 获取无障碍树快照 |
| `mcp_microsoft_pla_browser_take_screenshot` | 截图 |
| `mcp_microsoft_pla_browser_run_code_unsafe` | 执行复杂 Playwright JS 代码（主要工具） |
| `mcp_microsoft_pla_browser_click` | 简单点击 |
| `mcp_microsoft_pla_browser_type` | 文本输入 |
| `mcp_microsoft_pla_browser_press_key` | 键盘操作 |

> **重要**：`open_browser_page` 会开启全新上下文（不共享已登录会话）。全程使用 `mcp_microsoft_pla_browser_*` 工具集，**不可混用** `open_browser_page`。

---

## 测试账号与环境

| 参数 | 值 |
|------|---|
| 账号 | `v-yixueli@microsoft.com` |
| 订阅 | `Liftr-Nginx-Test` |
| Resource Group | `lyx-liftr-test` |
| Region | `West Central US` |
| 截图目录 | `sc4-screenshots/`（相对于工作目录） |

---

## 结果记录方式

在 Agent 执行过程中，维护一个内部结果数组，每个测试点记录：

```
{ scenario, tcId, description, status: 'PASS'|'FAIL'|'WARN', detail }
```

每个测试点结束后立即记录。全部 SC 结束后，使用 `mcp_microsoft_pla_browser_run_code_unsafe` 在控制台输出 Markdown 表格。

**在 `run_code_unsafe` 中追加结果的模式（所有 TC 共用）：**

```js
// 在每个 run_code_unsafe 代码块开头初始化（若第一次执行）
if (!globalThis.__testResults) globalThis.__testResults = [];

// 记录结果
globalThis.__testResults.push({
  scenario: 'SC1',
  tcId: 'SC1-TC01',
  description: '搜索 NGINXaaS 进入 Basics',
  status: 'PASS',
  detail: ''
});
```

---

## Portal 导航 URL

```
https://portal.azure.com/?feature.customportal=false&feature.canmodifystamps=true&Azure_Marketplace_Nginx=stage1&microsoft_azure_marketplace_ItemHideKey=Azure_Marketplace_NGINX#home
```

---

## SC1：Service Discovery

### 目标

搜索 NGINXaaS → 进入资源列表 → 点击 +Create → 验证 Basics 标签为活跃状态。

### 步骤

#### Step 1-1：导航到 Azure Portal

```
mcp_microsoft_pla_browser_navigate(url: <Portal URL>)
```

若跳转到 `login.microsoftonline.com`：
- 查找账号 tile：`[data-test-id="v-yixueli@microsoft.com"]` → 点击
- 若出现邮箱输入框，填入账号后点击 Next，等待企业 SSO 完成
- 若出现"Stay signed in?"，点击 Yes

等待 Portal 首页搜索框出现：

```js
async (page) => {
  await page.waitForSelector(
    '[role="combobox"][aria-label*="Search"], input[aria-label*="Search resources"]',
    { timeout: 120000 }
  );
  return 'Portal home loaded';
}
```

#### Step 1-2：搜索 NGINXaaS

```js
async (page) => {
  const searchBox = page.locator('[role="combobox"][aria-label*="Search"]').first();
  await searchBox.click();
  // 必须用 pressSequentially，fill() 不触发 Portal input 事件
  await searchBox.pressSequentially('nginxaas', { delay: 80 });
  await page.waitForSelector('[role="listbox"] [role="option"]', { timeout: 10000 });
  return 'Search results appeared';
}
```

#### Step 1-3：点击 NGINXaaS（Services 分类）

```js
async (page) => {
  // 精确匹配 Services 下的 NGINXaaS，避免误点 Marketplace 项
  await page.locator('[role="option"]').filter({ hasText: /^NGINXaaS$/ }).first().click();
  await page.waitForSelector('iframe[name="BrowseResource.ReactView"]', { timeout: 30000 });
  await page.waitForTimeout(3000);
  return 'Resource list loaded';
}
```

#### Step 1-4：点击 +Create

```js
async (page) => {
  const createBtn = page
    .frameLocator('iframe[name="BrowseResource.ReactView"]')
    .locator('[role="menuitem"]:has-text("Create")');
  await createBtn.waitFor({ state: 'visible', timeout: 30000 });
  await createBtn.click();
  await page.waitForURL(/create\/f5-networks/i, { timeout: 30000 });
  await page.waitForTimeout(4000);
  return 'Create wizard opened';
}
```

> **关键点**：Create 按钮在 `iframe[name="BrowseResource.ReactView"]` 内，必须通过 `frameLocator()` 穿透 iframe。

#### Step 1-5：验证 Basics 标签激活

```js
async (page) => {
  if (!globalThis.__testResults) globalThis.__testResults = [];
  const projectDetailsVisible = await page.locator('text=Project details').isVisible({ timeout: 15000 }).catch(() => false);
  const tabs = page.locator('[role="tab"]');
  const count = await tabs.count();
  let basicsActive = false;
  for (let i = 0; i < count; i++) {
    const t = tabs.nth(i);
    const text = (await t.textContent().catch(() => '')).trim().toLowerCase();
    if (!text.includes('basics')) continue;
    const ariaSel = await t.getAttribute('aria-selected').catch(() => null);
    const cls = (await t.getAttribute('class').catch(() => '') || '');
    if (ariaSel === 'true' || cls.includes('azc-br-active')) { basicsActive = true; break; }
  }
  const passed = projectDetailsVisible && basicsActive;
  globalThis.__testResults.push({
    scenario: 'SC1', tcId: 'SC1', description: '打开 Create 向导，Basics 标签激活',
    status: passed ? 'PASS' : 'FAIL',
    detail: `projectDetailsVisible=${projectDetailsVisible}, basicsActive=${basicsActive}`
  });
  return JSON.stringify({ projectDetailsVisible, basicsActive, passed });
}
```

**通过标准：** `"Project details"` 可见，且 Basics tab 的 `aria-selected="true"` 或 class 含 `azc-br-active`。

---

## SC2：Basics 字段验证

### 前置条件

SC1 完成，页面在 `#create/f5-networks.f5-nginx-for-azure`，Basics 标签激活。

### Step 2-0：定位 Name 输入框（后续 TC 共用）

```js
async (page) => {
  // 通过 label.htmlFor 精确定位 Name input
  const nameInputId = await page.evaluate(() => {
    const label = [...document.querySelectorAll('label')]
      .find(l => /^Name\b/.test((l.textContent || '').trim()));
    return label?.htmlFor || null;
  });
  // 将 id 存入全局供后续使用
  globalThis.__nameInputId = nameInputId;
  return `nameInputId=${nameInputId}`;
}
```

**关键点：**
- 不能用 `getByLabel(/^Name$/i)`，Portal 中 label 父级是 div 容器，`getByLabel` 会匹配到非 input 元素
- 用 `label.htmlFor` → `[id="..."]` 属性选择器精确定位

---

### SC2 辅助函数（在每个 TC 的 run_code_unsafe 中内联使用）

#### fillNameAndTriggerValidation

```js
async function fillNameAndTriggerValidation(page, nameInput, value) {
  await nameInput.click({ clickCount: 3 });
  if (value === '') {
    await nameInput.press('Delete');
  } else {
    await nameInput.fill(value);
  }
  await page.waitForTimeout(300);
  await nameInput.press('Tab');
  await page.waitForTimeout(800);
}
```

#### getNameErrorMessage

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
    // 先检查 aria-errormessage / aria-describedby
    const errId = input.getAttribute('aria-errormessage') || input.getAttribute('aria-describedby');
    if (errId) {
      const errEl = document.getElementById(errId.split(' ')[0]);
      if (errEl) {
        const t = (errEl.innerText || errEl.textContent || '').replace(/\s+/g, ' ').trim();
        if (t && t.length > 5 && t.length < 300) return { ariaInvalid, errorText: t };
      }
    }
    // 向上最多 5 层，找 role="alert" 或 aria-live="assertive"
    let container = input.parentElement;
    for (let depth = 0; depth < 5 && container; depth++, container = container.parentElement) {
      for (const el of container.querySelectorAll('[role="alert"], [aria-live="assertive"]')) {
        const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (t && t.length > 5 && t.length < 300) return { ariaInvalid, errorText: t };
      }
      for (const el of container.querySelectorAll(
        'span[class*="error"], div[class*="error"], span[class*="invalid"], div[class*="invalid"]'
      )) {
        const t = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        if (t && t.length > 5 && t.length < 300) return { ariaInvalid, errorText: t };
      }
    }
    return { ariaInvalid, errorText: null };
  });
}
```

> **aria-invalid 是有效性权威来源**：`"true"` = 验证失败，`"false"` 或 `null` = 正常。

---

### TC-01 ~ TC-11：Name 非法值验证

对每个用例执行以下模板，`input` 替换为下表中的值：

| TC ID | input | 违反规则 |
|-------|-------|---------|
| TC-01 | `""` | 不能为空 |
| TC-02 | 31 个字母 | 长度 ≤ 30 |
| TC-03 | `-lyx-test` | 不能以 `-` 开头 |
| TC-04 | `lyx-test-` | 不能以 `-` 结尾 |
| TC-05 | `-lyx-test-` | 两端均为 `-` |
| TC-06 | `lyx test` | 含空格 |
| TC-07 | `lyx_test` | 含下划线 |
| TC-08 | `lyx@test` | 含 `@` |
| TC-09 | `lyx.test` | 含 `.` |
| TC-10 | `lyx#test!` | 含 `#!` |
| TC-11 | `中文名称` | 含非 ASCII 字符 |

```js
async (page) => {
  if (!globalThis.__testResults) globalThis.__testResults = [];
  const nameInput = globalThis.__nameInputId
    ? page.locator(`[id="${globalThis.__nameInputId}"]`)
    : page.locator('input[type="text"]').filter({ hasNot: page.locator('[aria-haspopup]') }).first();
  await nameInput.waitFor({ state: 'visible', timeout: 10000 });

  const tcInput = /* 替换为具体 input 值 */ '';
  const tcId = 'TC-01'; // 替换

  // 填写并触发验证
  await nameInput.click({ clickCount: 3 });
  if (tcInput === '') { await nameInput.press('Delete'); } else { await nameInput.fill(tcInput); }
  await page.waitForTimeout(300);
  await nameInput.press('Tab');
  await page.waitForTimeout(800);

  let { ariaInvalid, errorText } = await (async () => {
    // ... 执行 getNameErrorMessage 逻辑（见上方）
    return page.evaluate(() => {
      const label = [...document.querySelectorAll('label')]
        .find(l => /^Name\b/.test((l.textContent || '').trim()));
      const inputId = label?.htmlFor;
      const input = inputId ? document.getElementById(inputId) : null;
      if (!input) return { ariaInvalid: null, errorText: null };
      const ariaInvalid = input.getAttribute('aria-invalid');
      const errId = input.getAttribute('aria-errormessage') || input.getAttribute('aria-describedby');
      if (errId) {
        const errEl = document.getElementById(errId.split(' ')[0]);
        if (errEl) { const t = (errEl.innerText||'').replace(/\s+/g,' ').trim(); if (t&&t.length>5&&t.length<300) return { ariaInvalid, errorText: t }; }
      }
      let container = input.parentElement;
      for (let d = 0; d < 5 && container; d++, container = container.parentElement) {
        for (const el of container.querySelectorAll('[role="alert"],[aria-live="assertive"]')) {
          const t=(el.innerText||'').replace(/\s+/g,' ').trim(); if(t&&t.length>5&&t.length<300) return {ariaInvalid,errorText:t};
        }
      }
      return { ariaInvalid, errorText: null };
    });
  })();

  // TC-01 特殊处理：空值验证需通过 Review+create 往返触发
  if (tcInput === '' && ariaInvalid !== 'true' && !errorText) {
    // 点击 Review+create 按钮（role="button" DIV，不是 role="tab"）
    const reviewBtn = page.locator('[role="button"]:has-text("Review + create")').last();
    await reviewBtn.waitFor({ state: 'visible', timeout: 10000 });
    await reviewBtn.click();
    await page.waitForTimeout(2000);
    // 切回 Basics tab（名称可能变为 "Basics (1)"）
    const basicsTab = page.getByRole('tab', { name: /basics/i }).first();
    await basicsTab.waitFor({ state: 'visible', timeout: 10000 });
    await basicsTab.click();
    await page.waitForTimeout(1500);
    await nameInput.waitFor({ state: 'visible', timeout: 10000 });
    // 重新读取错误状态
    ({ ariaInvalid, errorText } = await page.evaluate(() => { /* 同上 getNameErrorMessage */ return {ariaInvalid:document.querySelector('input')?.getAttribute('aria-invalid'),errorText:null}; }));
  }

  const passed = ariaInvalid === 'true';
  globalThis.__testResults.push({
    scenario: 'SC2', tcId, description: `Name 非法值: "${tcInput}"`,
    status: passed ? 'PASS' : 'FAIL',
    detail: `ariaInvalid=${ariaInvalid}, errorText=${errorText}`
  });
  return JSON.stringify({ tcId, ariaInvalid, errorText, passed });
}
```

> **关键点（TC-01）：** Azure Portal 对空值的验证是**延迟触发**（blur 时不触发，导航时才批量标记）。必须点击底部 `[role="button"]:has-text("Review + create")` 按钮，**不是** `role="tab"` 的 Review+create 标签。Portal 会停留在 Basics（不跳转），然后点击 Basics tab 切回即可看到错误。

---

### TC-RG-01：Resource Group 空值验证

不主动填写 Resource Group（保持空），触发 Review+create 往返：

```js
async (page) => {
  if (!globalThis.__testResults) globalThis.__testResults = [];
  // 先清空可能已填写的 RG（通过打开下拉选择"空"选项或先确保 RG 为空）
  // 直接触发 Review+create 往返
  const reviewBtn = page.locator('[role="button"]:has-text("Review + create")').last();
  await reviewBtn.waitFor({ state: 'visible', timeout: 10000 });
  await reviewBtn.click();
  await page.waitForTimeout(2000);
  const basicsTab = page.getByRole('tab', { name: /basics/i }).first();
  await basicsTab.waitFor({ state: 'visible', timeout: 10000 });
  await basicsTab.click();
  await page.waitForTimeout(1500);

  // 多策略检测 RG 错误
  const rgError = await page.evaluate(() => {
    function findErr(root) {
      for (const el of root.querySelectorAll('[role="alert"],[aria-live="assertive"]')) {
        const t=(el.innerText||'').replace(/\s+/g,' ').trim();
        if(t&&t.length<300) return t;
      }
      for (const el of root.querySelectorAll('[class*="error"i],[class*="invalid"i],[class*="validation"i]')) {
        const t=(el.innerText||'').replace(/\s+/g,' ').trim();
        if(t&&t.length<300) return t;
      }
      return null;
    }
    // 策略：从 Resource group label 向上遍历找 combobox 容器
    const rgLabel = [...document.querySelectorAll('label,span,div')]
      .find(el => el.children.length<4 && /^resource\s*group/i.test((el.textContent||'').trim()) && el.textContent.trim().length<60);
    if (rgLabel) {
      let node = rgLabel.parentElement;
      for (let d=0;d<12&&node&&node!==document.body;d++,node=node.parentElement) {
        if(node.querySelector('[role="combobox"],select')) {
          const e=findErr(node); if(e) return {errorText:e};
        }
      }
    }
    // 兜底：全页扫描
    for (const el of document.querySelectorAll('[role="alert"],[aria-live="assertive"]')) {
      const t=(el.innerText||'').replace(/\s+/g,' ').trim();
      if(/the value must not be empty/i.test(t)) return {errorText:t};
    }
    return {errorText:null};
  });

  const passed = !!(rgError.errorText && /the value must not be empty/i.test(rgError.errorText));
  globalThis.__testResults.push({
    scenario:'SC2',tcId:'TC-RG-01',description:'Resource Group 空值 → Review+create 往返后出现错误',
    status:passed?'PASS':'FAIL',detail:`errorText=${rgError.errorText}`
  });
  return JSON.stringify(rgError);
}
```

---

### TC-RG-02 ~ TC-RG-VALID：Create new RG 弹框验证

| TC ID | 操作 | 预期结果 |
|-------|------|---------|
| TC-RG-02 | 检查 "Create new" 元素可见 | 元素存在且可见 |
| TC-RG-03 | 弹框 Name 为空，点击 OK | 弹框不关闭（提交被阻止） |
| TC-RG-04 | 弹框 Name = `rg-test.`（末尾句点） | 弹框内出现格式错误提示 |
| TC-RG-05 | 弹框 Name = `rg!test`（含 `!`） | 弹框内出现格式错误提示 |
| TC-RG-VALID | 弹框 Name = `lyx-rg-test` | 无错误，点击 OK，弹框关闭，RG 字段更新 |

```js
async (page) => {
  if (!globalThis.__testResults) globalThis.__testResults = [];
  // TC-RG-02：验证 "Create new" 可见
  const createNewEl = page.getByRole('button', { name: /create new/i })
    .or(page.locator('a').filter({ hasText: /^create new$/i })).first();
  const rg02Passed = await createNewEl.isVisible({ timeout: 10000 }).catch(() => false);
  globalThis.__testResults.push({scenario:'SC2',tcId:'TC-RG-02',description:'"Create new" RG 按钮可见',
    status:rg02Passed?'PASS':'FAIL',detail:''});

  if (!rg02Passed) return JSON.stringify({error:'Create new not found'});

  // 打开弹框
  await createNewEl.click();
  const popupCancelBtn = page.getByRole('button', { name: 'Cancel' });
  let popupDetected = false;
  try {
    await popupCancelBtn.waitFor({ state: 'visible', timeout: 8000 });
    popupDetected = true;
  } catch(_) {}

  if (!popupDetected) {
    globalThis.__testResults.push({scenario:'SC2',tcId:'TC-RG-03',description:'RG 弹框检测',
      status:'FAIL',detail:'弹框未出现'});
    return JSON.stringify({error:'popup not detected'});
  }

  // 定位弹框内 Name 输入框（XPath 从 Cancel 向上找含 input 的祖先）
  const rgNameInput = popupCancelBtn.locator('xpath=ancestor::*[.//input][1]//input').first();
  await rgNameInput.waitFor({ state: 'visible', timeout: 10000 });

  // 读取弹框错误函数（通过 locator.evaluate 保证在 iframe 中执行）
  const getRGErr = () => popupCancelBtn.evaluate((btn) => {
    let node=btn.parentElement;
    for(let i=0;i<12&&node&&node!==document.body;i++,node=node.parentElement){
      if(!node.querySelector('input'))continue;
      for(const el of node.querySelectorAll('[role="alert"],[aria-live="assertive"],[aria-live="polite"]')){
        const t=(el.innerText||'').replace(/\s+/g,' ').trim();if(t)return t;
      }
      for(const el of node.querySelectorAll('[class*="error"i],[class*="invalid"i]')){
        const t=(el.innerText||'').replace(/\s+/g,' ').trim();if(t&&t.length<400)return t;
      }
    }
    return null;
  });

  // TC-RG-03：空值 → OK 被阻止
  await rgNameInput.click({clickCount:3}); await rgNameInput.press('Delete');
  await page.waitForTimeout(400);
  const okBtn = page.getByRole('button',{name:'OK'}).first();
  await okBtn.click().catch(()=>{});
  await page.waitForTimeout(800);
  const cancelStillVisible03 = await popupCancelBtn.isVisible({timeout:1000}).catch(()=>false);
  const rg03Passed = cancelStillVisible03;
  globalThis.__testResults.push({scenario:'SC2',tcId:'TC-RG-03',description:'RG 弹框空值 → OK 被阻止',
    status:rg03Passed?'PASS':'FAIL',detail:cancelStillVisible03?'弹框未关闭':'弹框已关闭（意外）'});

  // TC-RG-04：rg-test.（末尾句点）
  if (!await popupCancelBtn.isVisible({timeout:2000}).catch(()=>false)) {
    await createNewEl.click();
    await popupCancelBtn.waitFor({state:'visible',timeout:8000});
  }
  await rgNameInput.click({clickCount:3}); await rgNameInput.fill('rg-test.');
  await rgNameInput.press('Tab'); await page.waitForTimeout(600);
  const err04 = await getRGErr();
  const rg04Passed = !!(err04&&/alphanumeric|underscore|parentheses|hyphen|period|not supported/i.test(err04));
  globalThis.__testResults.push({scenario:'SC2',tcId:'TC-RG-04',description:'RG 弹框 name=rg-test. → 格式错误',
    status:rg04Passed?'PASS':'FAIL',detail:`errorText=${err04}`});

  // TC-RG-05：rg!test（含 !）
  await rgNameInput.click({clickCount:3}); await rgNameInput.fill('rg!test');
  await rgNameInput.press('Tab'); await page.waitForTimeout(600);
  const err05 = await getRGErr();
  const rg05Passed = !!(err05&&/alphanumeric|underscore|parentheses|hyphen|period|not supported/i.test(err05));
  globalThis.__testResults.push({scenario:'SC2',tcId:'TC-RG-05',description:'RG 弹框 name=rg!test → 格式错误',
    status:rg05Passed?'PASS':'FAIL',detail:`errorText=${err05}`});

  // TC-RG-VALID：lyx-rg-test → OK，弹框关闭
  await rgNameInput.click({clickCount:3}); await rgNameInput.fill('lyx-rg-test');
  await rgNameInput.press('Tab'); await page.waitForTimeout(600);
  const errValid = await getRGErr();
  await okBtn.click().catch(()=>{});
  await page.waitForTimeout(1000);
  const dialogClosed = !(await popupCancelBtn.isVisible({timeout:2000}).catch(()=>false));
  const rgValidPassed = !errValid && dialogClosed;
  globalThis.__testResults.push({scenario:'SC2',tcId:'TC-RG-VALID',description:'RG 弹框合法名称 → 弹框关闭',
    status:rgValidPassed?'PASS':'FAIL',detail:`errValid=${errValid}, dialogClosed=${dialogClosed}`});

  return JSON.stringify({rg02Passed,rg03Passed,rg04Passed,rg05Passed,rgValidPassed});
}
```

> **关键点**："Create new" 弹框是 **inline callout**，**无 `role="dialog"`**，用 Cancel 按钮是否可见判断弹框开关状态。`popupCancelBtn.evaluate()` 而非 `page.evaluate()`，确保在 iframe 内执行。

---

### SC2 结束：填写有效 Basics 准备进入 SC3

SC2 测试完成后，需确保 Basics 所有字段有效才能前进到 Networking。

```js
async (page) => {
  // 1. 订阅选择
  const subCorrect = await page.evaluate(() => {
    const lbl=[...document.querySelectorAll('label')].find(l=>/^Subscription/.test(l.textContent?.trim()));
    if(!lbl)return false;
    let el=lbl.parentElement;
    for(let i=0;i<5;i++){if(!el)break;if(el.textContent?.includes('Liftr-Nginx-Test'))return true;el=el.parentElement;}
    return false;
  });
  if(!subCorrect){
    await page.evaluate(()=>{
      const lbl=[...document.querySelectorAll('label')].find(l=>/^Subscription/.test(l.textContent?.trim()));
      if(!lbl)return;let el=lbl.parentElement;
      for(let i=0;i<6;i++){if(!el)break;const ctrl=el.querySelector('button[aria-haspopup="listbox"],[role="combobox"]');if(ctrl){ctrl.click();return;}el=el.parentElement;}
    });
    await page.waitForTimeout(800);
    await page.locator('[role="option"]').filter({hasText:'Liftr-Nginx-Test'}).first().click();
    await page.waitForTimeout(2000);
  }

  // 2. Resource Group
  const rgCorrect = await page.evaluate(()=>{
    const lbl=[...document.querySelectorAll('label')].find(l=>/^Resource group/.test(l.textContent?.trim()));
    if(!lbl)return false;let el=lbl.parentElement;
    for(let i=0;i<5;i++){if(!el)break;if(el.textContent?.includes('lyx-liftr-test'))return true;el=el.parentElement;}
    return false;
  });
  if(!rgCorrect){
    const rgDropDiv=page.locator('div[aria-label="Create new or use existing Resource group"]');
    await rgDropDiv.waitFor({state:'visible',timeout:10000});await rgDropDiv.click();
    await page.waitForTimeout(800);
    const rgFilterInput=page.locator('input[aria-label="Type to filter result or use down arrow to choose options"]').nth(1);
    await rgFilterInput.waitFor({state:'visible',timeout:8000});await rgFilterInput.click();
    await rgFilterInput.pressSequentially('lyx-liftr-test',{delay:50});
    await page.waitForTimeout(1000);await page.keyboard.press('ArrowDown');await page.waitForTimeout(400);await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);
  }

  // 3. Name（有效值）
  const nameInput = globalThis.__nameInputId
    ? page.locator(`[id="${globalThis.__nameInputId}"]`)
    : page.locator('input[type="text"]').filter({hasNot:page.locator('[aria-haspopup]')}).first();
  await nameInput.waitFor({state:'visible',timeout:10000});
  await nameInput.click({clickCount:3});
  const now=new Date();
  const instanceName=`lyx-sc2-${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
  await nameInput.fill(instanceName);
  await nameInput.press('Tab');await page.waitForTimeout(500);

  // 4. Region（West Central US）
  const regionHandle=await page.evaluateHandle(()=>{
    const lbl=[...document.querySelectorAll('label')].find(l=>/^Region\b/.test((l.textContent||'').trim()));
    if(!lbl)return null;let el=lbl.parentElement;
    for(let i=0;i<6;i++){if(!el)break;const btn=el.querySelector('button[aria-haspopup="listbox"],[role="combobox"]');if(btn)return btn;el=el.parentElement;}
    return null;
  });
  const regionEl=regionHandle.asElement();
  if(regionEl){
    const controlsId=await regionEl.getAttribute('aria-controls');
    await regionEl.click();await page.waitForTimeout(800);
    if(controlsId){
      const popup=page.locator(`#${controlsId}`);
      await popup.waitFor({state:'visible',timeout:5000});
      const filterInput=popup.locator('input').first();
      await filterInput.click();
      await filterInput.pressSequentially('West central us',{delay:80});
      await page.waitForTimeout(1000);
      await filterInput.press('ArrowDown');await page.waitForTimeout(500);await filterInput.press('Enter');
    }
  }
  await page.waitForTimeout(1000);

  // 5. Pricing Plan（Standard v3）
  const pricingBtn=page.locator('text=Select pricing plan').first();
  const pricingBtnVisible=await pricingBtn.isVisible({timeout:5000}).catch(()=>false);
  if(pricingBtnVisible){
    await pricingBtn.click();await page.waitForTimeout(2500);
    const v3Row=page.locator('[role="row"],tr,li').filter({hasText:/Standard V3/i}).filter({hasNotText:/Test|TESTING/i}).first();
    await v3Row.waitFor({state:'visible',timeout:15000});
    const radio=v3Row.locator('input[type="radio"]');
    if(await radio.count()>0){await radio.click();}else{await v3Row.click();}
    await page.waitForTimeout(1000);
    const confirmBtn=page.locator('text=Confirm Plan').first();
    await confirmBtn.waitFor({state:'visible',timeout:15000});await confirmBtn.click();
    await page.waitForTimeout(2000);
  }

  return `Basics filled: name=${instanceName}`;
}
```

---

## SC3：Networking 配置验证

### 前置条件

SC2 完成且 Basics 已填写有效值（Subscription、RG、Name、Region、Pricing Plan）。

### Step 3-0：进入 Networking 标签页

```js
async (page) => {
  // 展开虚拟网络配置区域（通过绝对 XPath 的 checkbox/span）
  const vnetSpan = page.locator(
    'xpath=/html/body/div[1]/div[4]/div[1]/div[1]/main/div[3]/div[2]/section[2]/div[2]/div[1]/div[4]/div[2]/div/div/div[2]/div/div[2]/div[2]/div/div[2]/div/div[3]/div[3]/div[2]/div[2]/div/div/span'
  ).first();

  // 先点击 Next 进入 Networking
  const nextBtn = page.getByRole('button',{name:/^next$/i}).first();
  await nextBtn.waitFor({state:'visible',timeout:10000});
  await nextBtn.click();
  await page.waitForTimeout(4000);

  // 尝试展开虚拟网络配置
  const spanVisible = await vnetSpan.isVisible({timeout:5000}).catch(()=>false);
  if(spanVisible){
    await vnetSpan.scrollIntoViewIfNeeded().catch(()=>{});
    await vnetSpan.click();
    await page.waitForTimeout(1000);
    const ariaChecked = await vnetSpan.getAttribute('aria-checked').catch(()=>null);
    return `Networking page opened, vnet checkbox ariaChecked=${ariaChecked}`;
  }
  return 'Networking page opened (vnet span not found by XPath, may need manual check)';
}
```

> **关键点**：Networking 页 checkbox 目前只能通过绝对 XPath 定位，Portal DOM 结构较脆弱，如 XPath 失效请用 DevTools 重新抓取当前 XPath 并更新本 Skill。

### VNet/Subnet 下拉操作辅助函数

VNet 和 Subnet 控件使用 `position: absolute`，Playwright `waitFor({ state: 'visible' })` 会超时，必须通过 `evaluateHandle` 绕过：

```js
async function clickDropdownByIndex(page, index) {
  const handle = await page.evaluateHandle((idx) => {
    const all = [...document.querySelectorAll('.fxc-dropdown-open.azc-input, .fxc-dropdown-open')];
    const withContent = all.filter(el => {
      const rect = el.getBoundingClientRect();
      return (rect.width > 0 || rect.height > 0) && (el.textContent || '').trim().length > 0;
    });
    return withContent[idx] || null;
  }, index);
  const el = handle.asElement();
  if (!el) throw new Error(`Dropdown at index ${index} not found`);
  await el.click();
  await page.waitForTimeout(1000);
}
```

下拉选项使用 `.fxc-dropdown-option` 类（而非 `[role="option"]`，会匹配到搜索历史隐藏元素）：

```js
async function selectDropdownOption(page, pattern) {
  await page.waitForTimeout(500);
  const allOpts = await page.locator('.fxc-dropdown-option').all();
  for (const opt of allOpts) {
    const visible = await opt.isVisible().catch(() => false);
    if (!visible) continue;
    const text = (await opt.textContent().catch(() => '')) || '';
    if (pattern.test(text)) { await opt.click(); return text; }
  }
  throw new Error(`Option matching ${pattern} not found`);
}
```

---

### TC-NET-01：默认新建 VNet/Subnet 验证

```js
async (page) => {
  if (!globalThis.__testResults) globalThis.__testResults = [];
  // 读取当前 VNet/Subnet 下拉显示值
  const dropdownTexts = await page.evaluate(() => {
    const all = [...document.querySelectorAll('.fxc-dropdown-open.azc-input, .fxc-dropdown-open')]
      .filter(el => {
        const rect=el.getBoundingClientRect();
        return (rect.width>0||rect.height>0)&&(el.textContent||'').trim().length>0;
      });
    return all.map(el=>(el.textContent||'').trim());
  });
  // 期望：第一项含 "(New)" VNet 名称，第二项含 "(New) default"
  const vnetText = dropdownTexts[0] || '';
  const subnetText = dropdownTexts[1] || '';
  const vnetMatch = /\(New\)\s*\S+-vnet/i.test(vnetText);
  const subnetMatch = /\(New\)\s*default/i.test(subnetText);
  const passed = vnetMatch && subnetMatch;
  globalThis.__testResults.push({
    scenario:'SC3',tcId:'TC-NET-01',description:'默认新建 VNet/Subnet',
    status:passed?'PASS':'FAIL',detail:`vnet=${vnetText}, subnet=${subnetText}`
  });
  return JSON.stringify({vnetText,subnetText,passed});
}
```

---

### TC-NET-02：公共 IP 有 New / Existing 两个选项

```js
async (page) => {
  if (!globalThis.__testResults) globalThis.__testResults = [];
  const bodyText = await page.evaluate(() => {
    const sec = document.querySelector('section, [class*="networking"], [class*="Networking"]');
    return (sec || document.body).textContent.replace(/\s+/g,' ').trim();
  });
  const hasNew = /\bNew\b/i.test(bodyText);
  const hasExisting = /\bExisting\b/i.test(bodyText);
  const passed = hasNew && hasExisting;
  globalThis.__testResults.push({
    scenario:'SC3',tcId:'TC-NET-02',description:'公共 IP 有 New/Existing 选项',
    status:passed?'PASS':'FAIL',detail:`hasNew=${hasNew}, hasExisting=${hasExisting}`
  });
  return JSON.stringify({hasNew,hasExisting,passed});
}
```

---

### TC-NET-03：Private Only — 静态 IP 验证逻辑

```js
async (page) => {
  if (!globalThis.__testResults) globalThis.__testResults = [];
  // 点击 Private Only 切换控件
  const privateOnlyControl = page.locator('[role="switch"], [role="checkbox"]')
    .filter({ hasText: /private\s*only/i }).first()
    .or(page.locator('label').filter({hasText:/private\s*only/i}).first());
  const clickTarget = await privateOnlyControl.isVisible({timeout:5000}).catch(()=>false)
    ? privateOnlyControl
    : page.locator('text=Private Only').first();
  await clickTarget.click({force:true}).catch(()=>{});
  await page.waitForTimeout(2000);

  // 验证静态 IP 字段出现
  const staticIPFieldVisible = await page.locator('text=/private static IP|static IP/i').isVisible({timeout:5000}).catch(()=>false);
  // 空值校验
  const staticIPInput = page.locator('input[type="text"]').filter({hasNot: page.locator('[aria-haspopup]')}).last();
  await staticIPInput.click({clickCount:3}).catch(()=>{});
  await staticIPInput.press('Delete').catch(()=>{});
  await staticIPInput.press('Tab').catch(()=>{});
  await page.waitForTimeout(500);
  const emptyAriaInvalid = await staticIPInput.getAttribute('aria-invalid').catch(()=>null);

  // 切回 Public IP
  await clickTarget.click({force:true}).catch(()=>{});
  await page.waitForTimeout(1000);

  const passed = staticIPFieldVisible && emptyAriaInvalid === 'true';
  globalThis.__testResults.push({
    scenario:'SC3',tcId:'TC-NET-03',description:'Private Only — 静态 IP 空值验证',
    status:passed?'PASS':'FAIL',detail:`staticIPFieldVisible=${staticIPFieldVisible}, emptyAriaInvalid=${emptyAriaInvalid}`
  });
  return JSON.stringify({staticIPFieldVisible,emptyAriaInvalid,passed});
}
```

---

### TC-NET-04：新 VNet 下入站端口 80/443 可选

```js
async (page) => {
  if (!globalThis.__testResults) globalThis.__testResults = [];
  const bodyText = await page.evaluate(() => (document.body.textContent||'').replace(/\s+/g,' '));
  const has80 = /port.*80|80.*port|\b80\b/i.test(bodyText);
  const has443 = /port.*443|443.*port|\b443\b/i.test(bodyText);
  const passed = has80 || has443; // 至少显示一个端口选项
  globalThis.__testResults.push({
    scenario:'SC3',tcId:'TC-NET-04',description:'新 VNet 下入站端口 80/443 可选',
    status:passed?'PASS':'WARN',detail:`has80=${has80}, has443=${has443}`
  });
  return JSON.stringify({has80,has443,passed});
}
```

---

### TC-NET-05：切换到现有 VNet（lyx-vnet02），入站端口规则变化

```js
async (page) => {
  if (!globalThis.__testResults) globalThis.__testResults = [];
  // 点击 VNet 下拉（index 0）
  const dropHandle0 = await page.evaluateHandle(() => {
    const all=[...document.querySelectorAll('.fxc-dropdown-open.azc-input,.fxc-dropdown-open')]
      .filter(el=>{const r=el.getBoundingClientRect();return(r.width>0||r.height>0)&&(el.textContent||'').trim().length>0;});
    return all[0]||null;
  });
  const drop0 = dropHandle0.asElement();
  if (!drop0) {
    globalThis.__testResults.push({scenario:'SC3',tcId:'TC-NET-05',description:'切换现有 VNet lyx-vnet02',status:'FAIL',detail:'VNet 下拉未找到'});
    return 'VNet dropdown not found';
  }
  await drop0.click(); await page.waitForTimeout(1000);

  // 选择 lyx-vnet02（正常大小的现有 VNet）
  const opts = await page.locator('.fxc-dropdown-option').all();
  let vnetSelected = false;
  for (const opt of opts) {
    const visible=await opt.isVisible().catch(()=>false);
    if(!visible)continue;
    const text=(await opt.textContent().catch(()=>'')||'');
    if(/lyx-vnet02/i.test(text)){await opt.click();vnetSelected=true;break;}
  }
  await page.waitForTimeout(2000);

  // 选择 subnet
  if(vnetSelected){
    const dropHandle1=await page.evaluateHandle(()=>{
      const all=[...document.querySelectorAll('.fxc-dropdown-open.azc-input,.fxc-dropdown-open')]
        .filter(el=>{const r=el.getBoundingClientRect();return(r.width>0||r.height>0)&&(el.textContent||'').trim().length>0;});
      return all[1]||null;
    });
    const drop1=dropHandle1.asElement();
    if(drop1){
      await drop1.click();await page.waitForTimeout(800);
      const subOpts=await page.locator('.fxc-dropdown-option').all();
      for(const opt of subOpts){
        const visible=await opt.isVisible().catch(()=>false);
        if(!visible)continue;
        const t=(await opt.textContent().catch(()=>'')||'');
        if(/default/i.test(t)){await opt.click();break;}
      }
    }
  }
  await page.waitForTimeout(1000);

  const passed = vnetSelected;
  globalThis.__testResults.push({
    scenario:'SC3',tcId:'TC-NET-05',description:'切换到现有 VNet lyx-vnet02',
    status:passed?'PASS':'FAIL',detail:`vnetSelected=${vnetSelected}`
  });
  return JSON.stringify({vnetSelected,passed});
}
```

---

### TC-NET-06：无效 VNet 拒绝（lyx-vnet01 子网过小）

> **重要行为**：选择 `lyx-vnet01` 后，Portal **立即**（无需点击 Next）在页面上显示错误，并将子网标记为 **`Incompatible subnets`**。  
> 预期错误文本（任一即可）：
> - *"The virtual network must contain an IPv4 address space larger than or equal to 27."*
> - *"Subnet should have an address prefix larger than 27."*
> - *"Subnet 'default' with address prefix '10.0.0.0/28' does not have enough capacity to add another IP address."*
>
> **NGINXaaS 要求**：子网 IPv4 地址空间前缀 ≤ /27（即至少 32 个 IP）。

```js
async (page) => {
  if (!globalThis.__testResults) globalThis.__testResults = [];
  // 切换到 lyx-vnet01（/28 子网过小，无法委托给 NGINXaaS）
  const dropHandle0=await page.evaluateHandle(()=>{
    const all=[...document.querySelectorAll('.fxc-dropdown-open.azc-input,.fxc-dropdown-open')]
      .filter(el=>{const r=el.getBoundingClientRect();return(r.width>0||r.height>0)&&(el.textContent||'').trim().length>0;});
    return all[0]||null;
  });
  const drop0=dropHandle0.asElement();
  if(!drop0){
    globalThis.__testResults.push({scenario:'SC3',tcId:'TC-NET-06',description:'无效 VNet lyx-vnet01 拒绝',status:'FAIL',detail:'VNet 下拉未找到'});
    return 'VNet dropdown not found';
  }
  await drop0.click();await page.waitForTimeout(1000);
  const opts=await page.locator('.fxc-dropdown-option').all();
  let vnetSelected=false;
  for(const opt of opts){
    const visible=await opt.isVisible().catch(()=>false);
    if(!visible)continue;
    const text=(await opt.textContent().catch(()=>'')||'');
    if(/lyx-vnet01(?!02)/i.test(text)){await opt.click();vnetSelected=true;break;}
  }
  // 选择后等待 Portal 立即显示错误（无需点击 Next）
  await page.waitForTimeout(2000);

  // 收集立即出现的错误（选 VNet 后即触发，不需要点 Next）
  const errors = await page.evaluate(()=>{
    const sels=['[role="alert"]','[class*="error"i]','[class*="validation"i]','[aria-live="assertive"]',
                '[class*="incompatible"i]'];
    const msgs=new Set();
    sels.forEach(sel=>document.querySelectorAll(sel).forEach(el=>{
      const t=(el.innerText||el.textContent||'').replace(/\s+/g,' ').trim();
      if(t&&t.length>5&&t.length<500)msgs.add(t);
    }));
    return [...msgs];
  });

  const rejectionKeywords = /\/27|address space|address prefix|incompatible|subnet|capacity|not valid|validation failed/i;
  let matched = errors.some(t=>rejectionKeywords.test(t));

  // 若立即未显示错误，再尝试点击 Next（兜底）
  if (!matched) {
    const nextBtn=page.getByRole('button',{name:/^next$/i}).first();
    const nextVisible=await nextBtn.isVisible({timeout:3000}).catch(()=>false);
    if(nextVisible){
      await nextBtn.click();await page.waitForTimeout(3000);
      const errorsAfterNext=await page.evaluate(()=>{
        const sels=['[role="alert"]','[class*="error"i]','[class*="validation"i]','[aria-live="assertive"]'];
        const msgs=new Set();
        sels.forEach(sel=>document.querySelectorAll(sel).forEach(el=>{
          const t=(el.innerText||el.textContent||'').replace(/\s+/g,' ').trim();
          if(t&&t.length>5&&t.length<500)msgs.add(t);
        }));
        return [...msgs];
      });
      matched=errorsAfterNext.some(t=>rejectionKeywords.test(t));
      errors.push(...errorsAfterNext);
    }
  }

  globalThis.__testResults.push({
    scenario:'SC3',tcId:'TC-NET-06',description:'无效 VNet（lyx-vnet01 /28 过小）— Portal 拒绝',
    status:matched?'PASS':'FAIL',
    detail:`errors=[${errors.slice(0,2).join(' | ')}]`
  });
  return JSON.stringify({matched,errors:errors.slice(0,3)});
}
```

---

## SC4：Tags 验证

### 前置条件

SC3 完成后，需导航到 Tags 标签页。

### Step 4-0：进入 Tags 标签页

```js
async (page) => {
  // 导航回 Basics，填好所有字段，然后逐 Next 前进到 Tags
  // 或者直接点击 Tags tab（若 wizard 允许直接跳转）
  const tagsTab = page.getByRole('tab', { name: /^tags$/i }).first()
    .or(page.locator('a, button').filter({ hasText: /^tags$/i }).first());
  const tabVisible = await tagsTab.isVisible({ timeout: 5000 }).catch(() => false);
  if (tabVisible) {
    await tagsTab.click();
    await page.waitForTimeout(2000);
    return 'Navigated to Tags via tab click';
  }
  // 通过 Next 进入
  const nextBtn = page.getByRole('button', { name: /^next$/i }).first();
  await nextBtn.waitFor({ state: 'visible', timeout: 10000 });
  await nextBtn.click();
  await page.waitForTimeout(3000);
  return 'Navigated to Tags via Next';
}
```

---

### Tags 操作核心辅助逻辑

**关键特性：**
1. **Name 输入框受 Knockout.js 绑定**，必须用 `pressSequentially({ delay: 80 })`，`fill()` 会被 KO observable 重置
2. **从 Name 导航到 Value 必须用 Tab**，直接 `click()` Value 可能导致 ID 失效
3. **提交（commit）editing row**：点击下一行的 Name 输入框（空编辑行），迫使当前行失焦提交
4. **Delete 按钮**：需通过无障碍 API（`getByRole('button', { name: 'Delete' })`）而非 `aria-label` 属性

```js
// 添加标签辅助函数（在 run_code_unsafe 中内联使用）
async function addTag(page, tagName, tagValue) {
  // 找到当前空编辑行的 Name 输入框
  const nameInputs = page.locator('input[aria-label="Name"]');
  const count = await nameInputs.count();
  const editNameInput = nameInputs.nth(count - 1); // 最后一个空编辑行
  await editNameInput.click();
  // KO 绑定：必须 pressSequentially
  await editNameInput.pressSequentially(tagName, { delay: 80 });
  await page.waitForTimeout(350);
  // 关闭可能弹出的 autocomplete 下拉，再 Tab 到 Value
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(400);
  // 填写 Value（Value 输入框可用 keyboard.type）
  await page.keyboard.type(tagValue);
  await page.waitForTimeout(300);
  // 点击下方空行的 Name 输入框以提交当前行
  const nameInputsAfter = page.locator('input[aria-label="Name"]');
  const afterCount = await nameInputsAfter.count();
  if (afterCount > count) {
    await nameInputsAfter.nth(afterCount - 1).click();
  }
  await page.waitForTimeout(500);
}
```

---

### TC-TAG-01 ~ TC-TAG-04：正常添加标签

| TC ID | key | value | 说明 |
|-------|-----|-------|------|
| TC-TAG-01 | `env` | `test` | 基础标签 |
| TC-TAG-02 | `owner` | `lyx` | 基础标签 |
| TC-TAG-03 | `project-name` | `nginx/stage` | 值含 `/` |
| TC-TAG-04 | `cost_center` | `123` | 键含 `_` |

```js
async (page) => {
  if (!globalThis.__testResults) globalThis.__testResults = [];
  const tagsToAdd = [
    {key:'env', value:'test', tcId:'TC-TAG-01'},
    {key:'owner', value:'lyx', tcId:'TC-TAG-02'},
    {key:'project-name', value:'nginx/stage', tcId:'TC-TAG-03'},
    {key:'cost_center', value:'123', tcId:'TC-TAG-04'},
  ];

  for (const {key, value, tcId} of tagsToAdd) {
    try {
      const nameInputs = page.locator('input[aria-label="Name"]');
      const count = await nameInputs.count();
      const editNameInput = nameInputs.nth(count - 1);
      await editNameInput.click();
      await editNameInput.pressSequentially(key, {delay:80});
      await page.waitForTimeout(350);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
      await page.keyboard.press('Tab');
      await page.waitForTimeout(400);
      await page.keyboard.type(value);
      await page.waitForTimeout(300);
      const nameInputsAfter = page.locator('input[aria-label="Name"]');
      const afterCount = await nameInputsAfter.count();
      if (afterCount > count) {
        await nameInputsAfter.nth(afterCount - 1).click();
      }
      await page.waitForTimeout(500);
      // 验证 display row 出现
      const rowText = await page.evaluate((k) => {
        const rows = [...document.querySelectorAll('[role="row"], tr')];
        return rows.some(r => r.textContent?.includes(k) && !r.querySelector('input')) ? 'found' : 'not found';
      }, key);
      globalThis.__testResults.push({scenario:'SC4',tcId,description:`添加标签 ${key}=${value}`,
        status:rowText==='found'?'PASS':'WARN',detail:`display row: ${rowText}`});
    } catch(e) {
      globalThis.__testResults.push({scenario:'SC4',tcId,description:`添加标签 ${key}=${value}`,
        status:'FAIL',detail:e.message});
    }
  }
  return 'TC-TAG-01~04 done';
}
```

---

### TC-TAG-05：重复标签名（env 已存在）

```js
async (page) => {
  if (!globalThis.__testResults) globalThis.__testResults = [];
  const nameInputs = page.locator('input[aria-label="Name"]');
  const count = await nameInputs.count();
  const editInput = nameInputs.nth(count - 1);
  await editInput.click();
  await editInput.pressSequentially('env', {delay:80});
  await page.waitForTimeout(350);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(800);

  const errorText = await page.evaluate(() => {
    for (const el of document.querySelectorAll('[role="alert"],[aria-live="assertive"],[class*="error"i]')) {
      const t=(el.innerText||'').replace(/\s+/g,' ').trim();
      if(/already used|duplicate|invalid tag name/i.test(t)) return t;
    }
    return null;
  });
  const passed = !!errorText;
  globalThis.__testResults.push({scenario:'SC4',tcId:'TC-TAG-05',description:'重复标签名 env → 出现错误',
    status:passed?'PASS':'FAIL',detail:`errorText=${errorText}`});

  // 清空当前编辑行（按 Escape 或 Delete 退出）
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  return JSON.stringify({errorText,passed});
}
```

---

### TC-TAG-SPECIAL：Name 含 `<>?` — 不支持字符提示

```js
async (page) => {
  if (!globalThis.__testResults) globalThis.__testResults = [];
  const nameInputs = page.locator('input[aria-label="Name"]');
  const count = await nameInputs.count();
  const editInput = nameInputs.nth(count - 1);
  await editInput.click();
  await editInput.pressSequentially('<>?', {delay:80});
  await page.waitForTimeout(350);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(600);

  const errorText = await page.evaluate(() => {
    for (const el of document.querySelectorAll('[role="alert"],[aria-live="assertive"],[class*="error"i]')) {
      const t=(el.innerText||'').replace(/\s+/g,' ').trim();
      if(/not supported|<>%|invalid/i.test(t)) return t;
    }
    return null;
  });
  const passed = !!errorText;
  globalThis.__testResults.push({scenario:'SC4',tcId:'TC-TAG-SPECIAL',description:'Name 含 "<>?" → 不支持字符提示',
    status:passed?'PASS':'FAIL',detail:`errorText=${errorText}`});

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  return JSON.stringify({errorText,passed});
}
```

---

### TC-TAG-EDIT：编辑 owner 的值（lyx → yixueli）

```js
async (page) => {
  if (!globalThis.__testResults) globalThis.__testResults = [];
  // 找到 owner 的 display row，点击进入 editing mode
  const rows = page.locator('[role="row"], tr');
  const count = await rows.count();
  let ownerRowIdx = -1;
  for (let i = 0; i < count; i++) {
    const text = await rows.nth(i).textContent().catch(() => '');
    if (text.includes('owner')) { ownerRowIdx = i; break; }
  }
  if (ownerRowIdx === -1) {
    globalThis.__testResults.push({scenario:'SC4',tcId:'TC-TAG-EDIT',description:'编辑 owner 值',status:'FAIL',detail:'owner row not found'});
    return 'owner row not found';
  }
  await rows.nth(ownerRowIdx).click();
  await page.waitForTimeout(500);

  // Value 输入框
  const valueInput = page.locator('input[aria-label="Value"]').first();
  await valueInput.click({clickCount:3});
  await page.keyboard.type('yixueli');
  await page.waitForTimeout(300);
  // 提交：点击下一行空编辑行
  const nameInputs = page.locator('input[aria-label="Name"]');
  await nameInputs.last().click();
  await page.waitForTimeout(500);

  // 验证 display row 更新
  const rowText = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[role="row"], tr')];
    return rows.find(r => r.textContent?.includes('owner'))?.textContent?.replace(/\s+/g,' ').trim() || '';
  });
  const passed = rowText.includes('yixueli');
  globalThis.__testResults.push({scenario:'SC4',tcId:'TC-TAG-EDIT',description:'编辑 owner 值 → yixueli',
    status:passed?'PASS':'FAIL',detail:`rowText=${rowText}`});
  return JSON.stringify({rowText,passed});
}
```

---

### TC-TAG-DEL：删除 cost_center 行

```js
async (page) => {
  if (!globalThis.__testResults) globalThis.__testResults = [];
  const rows = page.locator('[role="row"], tr').filter({ hasNotText: 'input' });
  const count = await rows.count();
  let costCenterRowIdx = -1;
  for (let i = 0; i < count; i++) {
    const text = await rows.nth(i).textContent().catch(() => '');
    if (text.includes('cost_center')) { costCenterRowIdx = i; break; }
  }
  if (costCenterRowIdx === -1) {
    // 尝试从所有行（含 editing）找
    const allRows = page.locator('[role="row"], tr');
    const allCount = await allRows.count();
    for (let i = 0; i < allCount; i++) {
      const t = await allRows.nth(i).textContent().catch(()=>'');
      if (t.includes('cost_center')) { costCenterRowIdx = i; break; }
    }
  }
  if (costCenterRowIdx === -1) {
    globalThis.__testResults.push({scenario:'SC4',tcId:'TC-TAG-DEL',description:'删除 cost_center 行',status:'FAIL',detail:'cost_center row not found'});
    return 'cost_center row not found';
  }

  // Delete 按钮通过无障碍 API（不能用 aria-label 属性选择）
  const allRows = page.locator('[role="row"], tr');
  await allRows.nth(costCenterRowIdx).getByRole('button', { name: 'Delete' }).click();
  await page.waitForTimeout(500);

  const stillExists = await page.evaluate(() =>
    [...document.querySelectorAll('[role="row"], tr')].some(r => r.textContent?.includes('cost_center'))
  );
  const passed = !stillExists;
  globalThis.__testResults.push({scenario:'SC4',tcId:'TC-TAG-DEL',description:'删除 cost_center 行',
    status:passed?'PASS':'FAIL',detail:`stillExists=${stillExists}`});
  return JSON.stringify({stillExists,passed});
}
```

---

### TC-TAG-REVIEW：进入 Review+Create 验证摘要

```js
async (page) => {
  if (!globalThis.__testResults) globalThis.__testResults = [];
  // 点击 Review + create 按钮导航
  const reviewBtn = page.getByRole('button', { name: /review.*create|review \+ create/i }).first();
  await reviewBtn.waitFor({ state: 'visible', timeout: 10000 });
  await reviewBtn.click();
  await page.waitForTimeout(4000);

  // 读取 Review 页文本（tabpanel）
  const reviewText = await page.evaluate(() => {
    const panel = document.querySelector('[role="tabpanel"]') || document.body;
    return (panel.innerText || panel.textContent || '').replace(/\s+/g,' ').trim();
  });

  // 验证无错误 banner
  const hasError = /validation failed|required information|not valid/i.test(reviewText);
  // 验证字段
  const hasSub = /Liftr-Nginx-Test/i.test(reviewText);
  const hasRG = /lyx-liftr-test/i.test(reviewText);
  const hasRegion = /West Central US/i.test(reviewText);
  // 验证 tags（env, owner, project-name 保留；cost_center 已删除）
  const hasEnvTag = /\benv\b/i.test(reviewText);
  const hasOwnerTag = /\bowner\b/i.test(reviewText);
  const hasProjTag = /project-name/i.test(reviewText);
  const noCostCenter = !/cost_center/i.test(reviewText);

  const passed = !hasError && hasSub && hasRG && hasRegion && hasEnvTag && hasOwnerTag && hasProjTag && noCostCenter;
  globalThis.__testResults.push({
    scenario:'SC4',tcId:'TC-TAG-REVIEW',description:'Review+Create 摘要验证',
    status:passed?'PASS':'FAIL',
    detail:`hasError=${hasError}, sub=${hasSub}, rg=${hasRG}, region=${hasRegion}, env=${hasEnvTag}, owner=${hasOwnerTag}, proj=${hasProjTag}, noCostCenter=${noCostCenter}`
  });
  return JSON.stringify({passed,hasError,hasSub,hasRG,hasRegion,hasEnvTag,hasOwnerTag,hasProjTag,noCostCenter});
}
```

---

## 最终结果汇总表

所有 SC1-SC4 测试点完成后，执行以下代码打印汇总：

```js
async (page) => {
  const results = globalThis.__testResults || [];
  const pass = results.filter(r=>r.status==='PASS').length;
  const fail = results.filter(r=>r.status==='FAIL').length;
  const warn = results.filter(r=>r.status==='WARN').length;

  let table = '\n╔══════════════════════════════════════════════════════════════╗\n';
  table += '║  NGINXaaS SC1-SC4 测试结果汇总                               ║\n';
  table += '╚══════════════════════════════════════════════════════════════╝\n\n';
  table += `| 场景 | TC ID | 描述 | 状态 | 详情 |\n`;
  table += `|------|-------|------|------|------|\n`;
  for (const r of results) {
    const icon = r.status==='PASS'?'✅':r.status==='WARN'?'⚠️':'❌';
    const detail = (r.detail||'').substring(0,60).replace(/\|/g,'\\|');
    table += `| ${r.scenario} | ${r.tcId} | ${r.description} | ${icon} ${r.status} | ${detail} |\n`;
  }
  table += `\n总计：✅ PASS=${pass}  ❌ FAIL=${fail}  ⚠️ WARN=${warn}  总计=${results.length}\n`;
  console.log(table);
  return table;
}
```

---

## 已知注意事项汇总

| 现象 | 原因 | 处理方式 |
|------|------|---------|
| TC-01 blur 后无错误 | 空值验证延迟触发（导航时批量校验） | 点击底部 `[role="button"]:has-text("Review + create")` 按钮（非 tab 元素） |
| "Review + create" tab 定位失败 | Create 向导中 tab 是 `role="tab"` 但 `getByRole('tab', name=/review/)` 可能超时 | 使用 `[role="button"]:has-text("Review + create")` 点击底部按钮；Portal 不会跳转，停留在 Basics |
| VNet/subnet 下拉 `waitFor visible` 超时 | 控件是 `position: absolute`，Playwright 基于布局流检测可见性无法识别 | 用 `evaluateHandle` 通过 `getBoundingClientRect` 检查布局 |
| `[role="option"]` 匹配到搜索历史 | Portal 全局搜索历史元素也有 `role="option"` | 改用 `.fxc-dropdown-option` 类遍历 + `isVisible()` 检查 |
| Name 输入被 KO 重置 | Tags Name 受 Knockout.js observable 绑定 | 必须用 `pressSequentially({ delay: 80 })`，不能用 `fill()` |
| Delete 按钮 `aria-label` 选择器失效 | 可访问名通过 alt text 计算，非 HTML 属性 | 用 `row.getByRole('button', { name: 'Delete' })` |
| "Create new" 弹框无 `role="dialog"` | 弹框是 inline callout | 用 Cancel 按钮是否可见作为弹框开关状态锚点 |
| `page.evaluate()` 在 iframe 中失效 | 只在主框架执行，弹框可能在 iframe 内 | 改用 `locator.evaluate()` 在 locator 所在 frame 中执行 |
| SC2 结束后 Basics 表单内容混乱 | 测试用例修改了字段值 | SC2 测试结束后执行"填写有效 Basics"步骤，再进入 SC3 |
| Networking XPath 失效 | Portal DOM 结构变化 | 用 DevTools 重新抓取最新 XPath 并更新本 Skill |
