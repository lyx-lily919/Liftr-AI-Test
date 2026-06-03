# NGINXaaS Create 向导全流程 MCP 测试 Skill

## 核心原则

**本 Skill 不使用任何 `.js` 脚本文件。**  
所有测试步骤由 AI Agent 直接调用 `mcp_microsoft_pla_browser_*` 工具在浏览器中实时执行。

---

## 测试架构

```
AI Agent
  └─ mcp_microsoft_pla_browser_navigate      导航
  └─ mcp_microsoft_pla_browser_run_code_unsafe  执行 Playwright JS（主要工具）
  └─ mcp_microsoft_pla_browser_take_screenshot  截图存证
  └─ mcp_microsoft_pla_browser_snapshot      读取页面状态
```

浏览器会话**全程保持**，不重新导航，SC1 → SC2 → SC3 → SC4 顺序执行。

---

## 测试配置

| 参数 | 值 |
|------|---|
| 账号 | `v-yixueli@microsoft.com` |
| 订阅 | `Liftr-Nginx-Test` |
| Resource Group | `lyx-liftr-test` |
| Region | `West Central US` |
| 浏览器 | Microsoft Edge（MCP 启动参数：`--browser msedge`） |
| 截图目录 | `sc4-screenshots/` |
| Portal URL | `https://portal.azure.com/?feature.customportal=false&feature.canmodifystamps=true&Azure_Marketplace_Nginx=stage1&microsoft_azure_marketplace_ItemHideKey=Azure_Marketplace_NGINX#home` |

---

## 结果追踪方式

在所有 `mcp_microsoft_pla_browser_run_code_unsafe` 调用中，通过 `globalThis.__r` 全局数组累积结果：

```js
if (!globalThis.__r) globalThis.__r = [];
globalThis.__r.push({ sc, id, desc, ok, note });
```

最终在一次 `run_code_unsafe` 中输出 Markdown 表格。

---

---

# SC1：Service Discovery

**目标：** 搜索 NGINXaaS → 点击 +Create → 验证 Basics 标签激活

---

## Step 1-1　导航到 Portal

调用：`mcp_microsoft_pla_browser_navigate`

```
url: https://portal.azure.com/?feature.customportal=false&feature.canmodifystamps=true&Azure_Marketplace_Nginx=stage1&microsoft_azure_marketplace_ItemHideKey=Azure_Marketplace_NGINX#home
```

---

## Step 1-2　处理登录 / 账号选择

调用：`mcp_microsoft_pla_browser_run_code_unsafe`

```js
async (page) => {
  for (let i = 0; i < 4; i++) {
    if (!page.url().includes('login.microsoftonline.com')) break;
    await page.waitForTimeout(2000);
    // 账号 tile（Pick an account）
    const tile = page.locator('[data-test-id="v-yixueli@microsoft.com"]');
    if (await tile.isVisible({ timeout: 3000 }).catch(() => false)) {
      await tile.click(); await page.waitForTimeout(2000); continue;
    }
    // 文字列表形式
    const acc = page.locator('text="v-yixueli@microsoft.com"').first();
    if (await acc.isVisible({ timeout: 3000 }).catch(() => false)) {
      await acc.click(); await page.waitForTimeout(2000); continue;
    }
    // "Stay signed in?" 提示
    const stay = page.locator('input[id="idSIButton9"][value="Yes"]');
    if (await stay.isVisible({ timeout: 3000 }).catch(() => false)) {
      await stay.click(); await page.waitForTimeout(2000);
    }
  }
  // 等待 Portal 首页搜索框
  await page.waitForSelector(
    '[role="combobox"][aria-label*="Search"], input[aria-label*="Search resources"]',
    { timeout: 120000 }
  );
  return 'portal-ready';
}
```

**关键点：** 使用循环最多检测 4 轮；等待顶部搜索框是 Portal 首页完全加载的可靠信号。

---

## Step 1-3　搜索 NGINXaaS

调用：`mcp_microsoft_pla_browser_run_code_unsafe`

```js
async (page) => {
  const box = page.locator('[role="combobox"][aria-label*="Search"]').first();
  await box.click();
  // fill() 不触发 Portal input 事件，必须用 pressSequentially
  await box.pressSequentially('nginxaas', { delay: 80 });
  await page.waitForSelector('[role="listbox"] [role="option"]', { timeout: 10000 });
  return 'search-results-visible';
}
```

**关键点：** `fill()` 直接设值不触发搜索事件，**必须** `pressSequentially`。

---

## Step 1-4　点击 NGINXaaS（Services 分类）

调用：`mcp_microsoft_pla_browser_run_code_unsafe`

```js
async (page) => {
  // /^NGINXaaS$/ 精确匹配，避免误点 Marketplace 项（有更长描述文字）
  await page.locator('[role="option"]').filter({ hasText: /^NGINXaaS$/ }).first().click();
  await page.waitForSelector('iframe[name="BrowseResource.ReactView"]', { timeout: 30000 });
  await page.waitForTimeout(3000);
  return 'resource-list-loaded';
}
```

---

## Step 1-5　点击 +Create

调用：`mcp_microsoft_pla_browser_run_code_unsafe`

```js
async (page) => {
  // Create 按钮在 iframe 内，必须通过 frameLocator 穿透
  const btn = page
    .frameLocator('iframe[name="BrowseResource.ReactView"]')
    .locator('[role="menuitem"]:has-text("Create")');
  await btn.waitFor({ state: 'visible', timeout: 30000 });
  await btn.click();
  await page.waitForURL(/create\/f5-networks/i, { timeout: 30000 });
  await page.waitForTimeout(4000);
  return 'create-wizard-opened';
}
```

**关键点：** Create 按钮在 `iframe[name="BrowseResource.ReactView"]` 内，直接在 `page` 上查找会失败。

---

## Step 1-6　验证 Basics 标签激活（TC SC1）

调用：`mcp_microsoft_pla_browser_run_code_unsafe`

```js
async (page) => {
  if (!globalThis.__r) globalThis.__r = [];

  const projDetails = await page.locator('text=Project details').isVisible({ timeout: 15000 }).catch(() => false);

  let basicsActive = false;
  const tabs = page.locator('[role="tab"]');
  for (let i = 0; i < await tabs.count(); i++) {
    const text = (await tabs.nth(i).textContent().catch(() => '')).toLowerCase();
    if (!text.includes('basics')) continue;
    const sel = await tabs.nth(i).getAttribute('aria-selected').catch(() => null);
    const cls = await tabs.nth(i).getAttribute('class').catch(() => '') || '';
    if (sel === 'true' || cls.includes('azc-br-active')) { basicsActive = true; break; }
  }

  const ok = projDetails && basicsActive;
  globalThis.__r.push({ sc: 'SC1', id: 'SC1', desc: '打开 Create，Basics 标签激活', ok,
    note: `projDetails=${projDetails} basicsActive=${basicsActive}` });
  return JSON.stringify({ ok, projDetails, basicsActive });
}
```

**通过标准：** `"Project details"` 可见 + Basics tab `aria-selected="true"` 或 class 含 `azc-br-active`。

---

---

# SC2：Basics 字段验证

**前置条件：** SC1 完成，页面在 `#create/f5-networks.f5-nginx-for-azure`，Basics 标签激活。

---

## Step 2-0　定位 Name 输入框

调用：`mcp_microsoft_pla_browser_run_code_unsafe`

```js
async (page) => {
  // 通过 label.htmlFor 获取 input ID，避免 getByLabel 匹配到 div 父容器
  globalThis.__nameId = await page.evaluate(() => {
    const lbl = [...document.querySelectorAll('label')]
      .find(l => /^Name\b/.test((l.textContent || '').trim()));
    return lbl?.htmlFor || null;
  });
  return `nameId=${globalThis.__nameId}`;
}
```

---

## TC-01 ～ TC-11　Name 非法值验证

对下表中每个用例，调用一次 `mcp_microsoft_pla_browser_run_code_unsafe`，替换 `TC_ID` 和 `TC_INPUT`：

| TC ID | 输入值 | 违反规则 |
|-------|--------|---------|
| TC-01 | `""` (空) | 不能为空 |
| TC-02 | 31 个字母 | 长度 ≤ 30 |
| TC-03 | `-lyx-test` | 不能以 `-` 开头 |
| TC-04 | `lyx-test-` | 不能以 `-` 结尾 |
| TC-05 | `-lyx-test-` | 两端均为 `-` |
| TC-06 | `lyx test` | 含空格 |
| TC-07 | `lyx_test` | 含下划线 |
| TC-08 | `lyx@test` | 含 `@` |
| TC-09 | `lyx.test` | 含 `.` |
| TC-10 | `lyx#test!` | 含 `#!` |
| TC-11 | `中文名称` | 非 ASCII |

```js
async (page) => {
  if (!globalThis.__r) globalThis.__r = [];
  const TC_ID = 'TC-01';      // ← 替换
  const TC_INPUT = '';        // ← 替换

  const nameInput = globalThis.__nameId
    ? page.locator(`[id="${globalThis.__nameId}"]`)
    : page.locator('input[type="text"]').filter({ hasNot: page.locator('[aria-haspopup]') }).first();
  await nameInput.waitFor({ state: 'visible', timeout: 10000 });

  // 填值并失焦
  await nameInput.click({ clickCount: 3 });
  TC_INPUT === '' ? await nameInput.press('Delete') : await nameInput.fill(TC_INPUT);
  await page.waitForTimeout(300);
  await nameInput.press('Tab');
  await page.waitForTimeout(800);

  // 读取错误状态
  const getErr = () => page.evaluate(() => {
    const lbl = [...document.querySelectorAll('label')].find(l => /^Name\b/.test((l.textContent || '').trim()));
    const id = lbl?.htmlFor;
    const inp = id ? document.getElementById(id) : document.querySelector('input[type="text"]');
    if (!inp) return { inv: null, txt: null };
    const inv = inp.getAttribute('aria-invalid');
    const errId = inp.getAttribute('aria-errormessage') || inp.getAttribute('aria-describedby');
    if (errId) {
      const el = document.getElementById(errId.split(' ')[0]);
      if (el) { const t = (el.innerText || '').replace(/\s+/g, ' ').trim(); if (t && t.length < 300) return { inv, txt: t }; }
    }
    let c = inp.parentElement;
    for (let d = 0; d < 5 && c; d++, c = c.parentElement) {
      for (const el of c.querySelectorAll('[role="alert"],[aria-live="assertive"]')) {
        const t = (el.innerText || '').replace(/\s+/g, ' ').trim(); if (t && t.length < 300) return { inv, txt: t };
      }
    }
    return { inv, txt: null };
  });

  let { inv, txt } = await getErr();

  // TC-01 特殊：空值验证延迟触发，需 Review+create 往返
  if (TC_INPUT === '' && inv !== 'true' && !txt) {
    // 点击底部按钮（role="button"），不是 tab 元素
    const reviewBtn = page.locator('[role="button"]:has-text("Review + create")').last();
    await reviewBtn.waitFor({ state: 'visible', timeout: 10000 });
    await reviewBtn.click();
    await page.waitForTimeout(2000);
    // 切回 Basics（名称可能变为 "Basics (1)"）
    const basicsTab = page.getByRole('tab', { name: /basics/i }).first();
    await basicsTab.waitFor({ state: 'visible', timeout: 10000 });
    await basicsTab.click();
    await page.waitForTimeout(1500);
    await nameInput.waitFor({ state: 'visible', timeout: 10000 });
    ({ inv, txt } = await getErr());
  }

  const ok = inv === 'true';
  globalThis.__r.push({ sc: 'SC2', id: TC_ID, desc: `Name="${TC_INPUT}"`, ok, note: `inv=${inv} | ${txt || ''}` });
  return JSON.stringify({ TC_ID, ok, inv, txt });
}
```

**TC-01 关键点：**
- 空值错误是**延迟触发**，blur 时不出现，必须通过导航触发批量校验
- 点击底部 `[role="button"]:has-text("Review + create")`（不是 wizard tab），Portal 留在 Basics 不跳转
- 切回后 Basics 标签名可能变为 `"Basics (1)"`，用 `/basics/i` 宽松匹配

---

## TC-RG-01　Resource Group 空值验证

调用：`mcp_microsoft_pla_browser_run_code_unsafe`

```js
async (page) => {
  if (!globalThis.__r) globalThis.__r = [];
  // 触发 Review+create 往返
  const reviewBtn = page.locator('[role="button"]:has-text("Review + create")').last();
  await reviewBtn.waitFor({ state: 'visible', timeout: 10000 });
  await reviewBtn.click(); await page.waitForTimeout(2000);
  const basicsTab = page.getByRole('tab', { name: /basics/i }).first();
  await basicsTab.waitFor({ state: 'visible', timeout: 10000 });
  await basicsTab.click(); await page.waitForTimeout(1500);

  const rgErr = await page.evaluate(() => {
    // 从 "Resource group" 标签向上遍历找 combobox 容器
    const lbl = [...document.querySelectorAll('label,span,div')]
      .find(el => el.children.length < 4 && /^resource\s*group/i.test((el.textContent || '').trim()) && el.textContent.trim().length < 60);
    if (lbl) {
      let node = lbl.parentElement;
      for (let d = 0; d < 12 && node && node !== document.body; d++, node = node.parentElement) {
        if (!node.querySelector('[role="combobox"],select')) continue;
        for (const el of node.querySelectorAll('[role="alert"],[aria-live="assertive"],[aria-live="polite"]')) {
          const t = (el.innerText || '').replace(/\s+/g, ' ').trim(); if (t) return t;
        }
      }
    }
    // 兜底：全页扫描
    for (const el of document.querySelectorAll('[role="alert"],[aria-live="assertive"]')) {
      const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
      if (/the value must not be empty/i.test(t)) return t;
    }
    return null;
  });

  const ok = !!(rgErr && /the value must not be empty/i.test(rgErr));
  globalThis.__r.push({ sc: 'SC2', id: 'TC-RG-01', desc: 'RG 空值 → Review+create 往返触发错误', ok, note: rgErr || '' });
  return JSON.stringify({ ok, rgErr });
}
```

---

## TC-RG-02 ～ TC-RG-VALID　"Create new" RG 弹框验证

调用：`mcp_microsoft_pla_browser_run_code_unsafe`

```js
async (page) => {
  if (!globalThis.__r) globalThis.__r = [];

  // TC-RG-02：验证 "Create new" 可见
  const createNew = page.getByRole('button', { name: /create new/i })
    .or(page.locator('a').filter({ hasText: /^create new$/i })).first();
  const rg02ok = await createNew.isVisible({ timeout: 10000 }).catch(() => false);
  globalThis.__r.push({ sc: 'SC2', id: 'TC-RG-02', desc: '"Create new" 按钮可见', ok: rg02ok, note: '' });
  if (!rg02ok) return 'TC-RG-02 FAIL: Create new not found';

  // 打开弹框（弹框是 inline callout，无 role="dialog"，用 Cancel 按钮检测）
  await createNew.click();
  const cancelBtn = page.getByRole('button', { name: 'Cancel' });
  await cancelBtn.waitFor({ state: 'visible', timeout: 8000 });

  // 定位弹框内 Name 输入框（XPath 从 Cancel 向上找含 input 的祖先）
  // 使用 cancelBtn.locator 而非 page.locator，确保在 Cancel 所在 frame（含 iframe）内查找
  const rgInput = cancelBtn.locator('xpath=ancestor::*[.//input][1]//input').first();
  await rgInput.waitFor({ state: 'visible', timeout: 10000 });

  // 读取弹框错误（locator.evaluate 在 Cancel 所在 frame 内执行，适配 iframe）
  const getDialogErr = () => cancelBtn.evaluate(btn => {
    let node = btn.parentElement;
    for (let i = 0; i < 12 && node && node !== document.body; i++, node = node.parentElement) {
      if (!node.querySelector('input')) continue;
      for (const el of node.querySelectorAll('[role="alert"],[aria-live="assertive"],[aria-live="polite"]')) {
        const t = (el.innerText || '').replace(/\s+/g, ' ').trim(); if (t) return t;
      }
      for (const el of node.querySelectorAll('[class*="error"i],[class*="invalid"i]')) {
        const t = (el.innerText || '').replace(/\s+/g, ' ').trim(); if (t && t.length < 400) return t;
      }
    }
    return null;
  });

  const okBtn = page.getByRole('button', { name: 'OK' }).first();

  // TC-RG-03：空值 → 点击 OK → 弹框不关闭
  await rgInput.click({ clickCount: 3 }); await rgInput.press('Delete'); await page.waitForTimeout(400);
  await okBtn.click().catch(() => {}); await page.waitForTimeout(800);
  const rg03ok = await cancelBtn.isVisible({ timeout: 1000 }).catch(() => false);
  globalThis.__r.push({ sc: 'SC2', id: 'TC-RG-03', desc: 'RG 弹框空值 → OK 被阻止', ok: rg03ok,
    note: rg03ok ? '弹框未关闭' : '弹框意外关闭' });

  // 确保弹框仍开着
  if (!await cancelBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await createNew.click(); await cancelBtn.waitFor({ state: 'visible', timeout: 8000 });
  }

  // TC-RG-04：rg-test.（末尾句点）
  await rgInput.click({ clickCount: 3 }); await rgInput.fill('rg-test.'); await rgInput.press('Tab'); await page.waitForTimeout(600);
  const err04 = await getDialogErr();
  const rg04ok = !!(err04 && /alphanumeric|underscore|hyphen|period|not supported/i.test(err04));
  globalThis.__r.push({ sc: 'SC2', id: 'TC-RG-04', desc: 'RG 弹框 name=rg-test. → 格式错误', ok: rg04ok, note: err04 || '' });

  // TC-RG-05：rg!test（含 !）
  await rgInput.click({ clickCount: 3 }); await rgInput.fill('rg!test'); await rgInput.press('Tab'); await page.waitForTimeout(600);
  const err05 = await getDialogErr();
  const rg05ok = !!(err05 && /alphanumeric|underscore|hyphen|period|not supported/i.test(err05));
  globalThis.__r.push({ sc: 'SC2', id: 'TC-RG-05', desc: 'RG 弹框 name=rg!test → 格式错误', ok: rg05ok, note: err05 || '' });

  // TC-RG-VALID：lyx-rg-test → OK → 弹框关闭
  await rgInput.click({ clickCount: 3 }); await rgInput.fill('lyx-rg-test'); await rgInput.press('Tab'); await page.waitForTimeout(600);
  const errV = await getDialogErr();
  await okBtn.click().catch(() => {}); await page.waitForTimeout(1000);
  const closed = !(await cancelBtn.isVisible({ timeout: 2000 }).catch(() => false));
  const rgVok = !errV && closed;
  globalThis.__r.push({ sc: 'SC2', id: 'TC-RG-VALID', desc: 'RG 弹框合法名称 → 弹框关闭', ok: rgVok,
    note: `errV=${errV} closed=${closed}` });

  return JSON.stringify({ rg02ok, rg03ok, rg04ok, rg05ok, rgVok });
}
```

**关键点：**
- 弹框是 **inline callout**，**没有 `role="dialog"`**，用 Cancel 按钮可见性判断弹框是否开着
- `cancelBtn.evaluate()` 而非 `page.evaluate()`，确保在 Cancel 所在 frame 内执行（兼容 iframe）
- `cancelBtn.locator('xpath=ancestor::...')` 保证 XPath 在同一 frame 内查找 input

---

## SC2 结束　填写有效 Basics 准备进入 SC3

调用：`mcp_microsoft_pla_browser_run_code_unsafe`

```js
async (page) => {
  // 1. Subscription
  const subOk = await page.evaluate(() => {
    const l = [...document.querySelectorAll('label')].find(l => /^Subscription/.test(l.textContent?.trim()));
    if (!l) return false;
    let e = l.parentElement;
    for (let i = 0; i < 5; i++) { if (!e) break; if (e.textContent?.includes('Liftr-Nginx-Test')) return true; e = e.parentElement; }
    return false;
  });
  if (!subOk) {
    await page.evaluate(() => {
      const l = [...document.querySelectorAll('label')].find(l => /^Subscription/.test(l.textContent?.trim()));
      if (!l) return; let e = l.parentElement;
      for (let i = 0; i < 6; i++) { if (!e) break; const c = e.querySelector('button[aria-haspopup="listbox"],[role="combobox"]'); if (c) { c.click(); return; } e = e.parentElement; }
    });
    await page.waitForTimeout(800);
    await page.locator('[role="option"]').filter({ hasText: 'Liftr-Nginx-Test' }).first().click();
    await page.waitForTimeout(2000);
  }

  // 2. Resource Group
  const rgOk = await page.evaluate(() => {
    const l = [...document.querySelectorAll('label')].find(l => /^Resource group/.test(l.textContent?.trim()));
    if (!l) return false;
    let e = l.parentElement;
    for (let i = 0; i < 5; i++) { if (!e) break; if (e.textContent?.includes('lyx-liftr-test')) return true; e = e.parentElement; }
    return false;
  });
  if (!rgOk) {
    const rg = page.locator('div[aria-label="Create new or use existing Resource group"]');
    await rg.waitFor({ state: 'visible', timeout: 10000 }); await rg.click(); await page.waitForTimeout(800);
    const fi = page.locator('input[aria-label="Type to filter result or use down arrow to choose options"]').nth(1);
    await fi.waitFor({ state: 'visible', timeout: 8000 }); await fi.click();
    await fi.pressSequentially('lyx-liftr-test', { delay: 50 });
    await page.waitForTimeout(1000); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(400); await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);
  }

  // 3. Name（有效值，格式 lyx-sc2-MMDDHHmm）
  const now = new Date();
  const name = `lyx-sc2-${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
  const ni = globalThis.__nameId ? page.locator(`[id="${globalThis.__nameId}"]`)
    : page.locator('input[type="text"]').filter({ hasNot: page.locator('[aria-haspopup]') }).first();
  await ni.waitFor({ state: 'visible', timeout: 10000 });
  await ni.click({ clickCount: 3 }); await ni.fill(name); await ni.press('Tab'); await page.waitForTimeout(500);

  // 4. Region（West Central US）
  const rh = await page.evaluateHandle(() => {
    const l = [...document.querySelectorAll('label')].find(l => /^Region\b/.test((l.textContent || '').trim()));
    if (!l) return null; let e = l.parentElement;
    for (let i = 0; i < 6; i++) { if (!e) break; const b = e.querySelector('button[aria-haspopup="listbox"],[role="combobox"]'); if (b) return b; e = e.parentElement; }
    return null;
  });
  const re = rh.asElement();
  if (re) {
    const cid = await re.getAttribute('aria-controls');
    await re.click(); await page.waitForTimeout(800);
    if (cid) {
      const popup = page.locator(`#${cid}`);
      await popup.waitFor({ state: 'visible', timeout: 5000 });
      const fi = popup.locator('input').first(); await fi.click();
      await fi.pressSequentially('West central us', { delay: 80 });
      await page.waitForTimeout(1000); await fi.press('ArrowDown'); await page.waitForTimeout(500); await fi.press('Enter');
    }
  }
  await page.waitForTimeout(1000);

  // 5. Pricing Plan（Standard v3）
  const pb = page.locator('text=Select pricing plan').first();
  if (await pb.isVisible({ timeout: 5000 }).catch(() => false)) {
    await pb.click(); await page.waitForTimeout(2500);
    const row = page.locator('[role="row"],tr,li').filter({ hasText: /Standard V3/i }).filter({ hasNotText: /Test|TESTING/i }).first();
    await row.waitFor({ state: 'visible', timeout: 15000 });
    const radio = row.locator('input[type="radio"]');
    await radio.count() > 0 ? await radio.click() : await row.click();
    await page.waitForTimeout(1000);
    const cb = page.locator('text=Confirm Plan').first();
    await cb.waitFor({ state: 'visible', timeout: 15000 }); await cb.click(); await page.waitForTimeout(2000);
  }

  return `basics-ready name=${name}`;
}
```

---

---

# SC3：Networking 配置验证

**前置条件：** Basics 所有字段已填写有效值。

---

## Step 3-0　进入 Networking 页面并展开 VNet 配置

调用：`mcp_microsoft_pla_browser_run_code_unsafe`

```js
async (page) => {
  // 点击 Next 进入 Networking
  const next = page.getByRole('button', { name: /^next$/i }).first();
  await next.waitFor({ state: 'visible', timeout: 10000 }); await next.click();
  await page.waitForTimeout(4000);

  // 展开 VNet 配置区域（绝对 XPath，Portal DOM 较脆弱，如失效用 DevTools 重新抓取）
  const span = page.locator(
    'xpath=/html/body/div[1]/div[4]/div[1]/div[1]/main/div[3]/div[2]/section[2]/div[2]/div[1]/div[4]/div[2]/div/div/div[2]/div/div[2]/div[2]/div/div[2]/div/div[3]/div[3]/div[2]/div[2]/div/div/span'
  ).first();
  if (await span.isVisible({ timeout: 5000 }).catch(() => false)) {
    await span.scrollIntoViewIfNeeded().catch(() => {}); await span.click(); await page.waitForTimeout(1000);
  }
  return 'networking-ready';
}
```

> **VNet/Subnet 下拉操作注意：** 这些控件使用 `position: absolute`，Playwright `waitFor({ state: 'visible' })` 会超时。必须通过 `evaluateHandle` + `getBoundingClientRect` 绕过，并用 `.fxc-dropdown-option` 类（非 `[role="option"]`）遍历选项。

---

## TC-NET-01　默认新建 VNet/Subnet

调用：`mcp_microsoft_pla_browser_run_code_unsafe`

```js
async (page) => {
  if (!globalThis.__r) globalThis.__r = [];
  const texts = await page.evaluate(() =>
    [...document.querySelectorAll('.fxc-dropdown-open.azc-input,.fxc-dropdown-open')]
      .filter(el => { const r = el.getBoundingClientRect(); return (r.width > 0 || r.height > 0) && (el.textContent || '').trim().length > 0; })
      .map(el => (el.textContent || '').replace(/\s+/g, ' ').trim())
  );
  const vnetOk = /\(New\)\s*\S+-vnet/i.test(texts[0] || '');
  const subnetOk = /\(New\)\s*default/i.test(texts[1] || '');
  const ok = vnetOk && subnetOk;
  globalThis.__r.push({ sc: 'SC3', id: 'TC-NET-01', desc: '默认新建 VNet/Subnet', ok,
    note: `vnet="${texts[0]}" subnet="${texts[1]}"` });
  return JSON.stringify({ ok, texts });
}
```

---

## TC-NET-02　公共 IP 有 New / Existing 选项

调用：`mcp_microsoft_pla_browser_run_code_unsafe`

```js
async (page) => {
  if (!globalThis.__r) globalThis.__r = [];
  const txt = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));
  const hasNew = /\bNew\b/i.test(txt);
  const hasExisting = /\bExisting\b/i.test(txt);
  const ok = hasNew && hasExisting;
  globalThis.__r.push({ sc: 'SC3', id: 'TC-NET-02', desc: '公共 IP 有 New/Existing 选项', ok,
    note: `hasNew=${hasNew} hasExisting=${hasExisting}` });
  return JSON.stringify({ ok, hasNew, hasExisting });
}
```

---

## TC-NET-03　Private Only — 静态 IP 空值/非法/合法校验

调用：`mcp_microsoft_pla_browser_run_code_unsafe`

```js
async (page) => {
  if (!globalThis.__r) globalThis.__r = [];

  // 切换到 Private Only
  const radio = page.locator('[role="radio"]').filter({ hasText: /private\s*only/i }).first();
  await radio.click({ force: true }); await page.waitForTimeout(2000);

  const staticVisible = await page.locator('text=/private static IP/i').isVisible({ timeout: 5000 }).catch(() => false);

  // 找到 Private static IP 输入框（最后一个非 combobox input）
  const inp = page.locator('input[type="text"]').filter({ hasNot: page.locator('[aria-haspopup]') }).last();

  // 空值校验
  await inp.click({ clickCount: 3 }).catch(() => {}); await inp.press('Delete').catch(() => {}); await inp.press('Tab').catch(() => {}); await page.waitForTimeout(500);
  const emptyInv = await inp.getAttribute('aria-invalid').catch(() => null);

  // 非法格式校验
  await inp.click({ clickCount: 3 }).catch(() => {}); await inp.fill('abc.def.1'); await inp.press('Tab').catch(() => {}); await page.waitForTimeout(500);
  const invalidInv = await inp.getAttribute('aria-invalid').catch(() => null);

  // 合法值校验
  await inp.click({ clickCount: 3 }).catch(() => {}); await inp.fill('172.22.0.10'); await inp.press('Tab').catch(() => {}); await page.waitForTimeout(500);
  const validInv = await inp.getAttribute('aria-invalid').catch(() => null);

  // 切回 Public Only
  const publicRadio = page.locator('[role="radio"]').filter({ hasText: /public\s*only/i }).first();
  await publicRadio.click({ force: true }).catch(() => {}); await page.waitForTimeout(1000);

  const ok = staticVisible && emptyInv === 'true';
  globalThis.__r.push({ sc: 'SC3', id: 'TC-NET-03', desc: 'Private Only 静态 IP 字段校验', ok,
    note: `staticVisible=${staticVisible} emptyInv=${emptyInv} invalidInv=${invalidInv} validInv=${validInv}` });
  return JSON.stringify({ ok, staticVisible, emptyInv, invalidInv, validInv });
}
```

---

## TC-NET-04　新 VNet 下入站端口显示 80/443（"2 selected"）

调用：`mcp_microsoft_pla_browser_run_code_unsafe`

```js
async (page) => {
  if (!globalThis.__r) globalThis.__r = [];
  // "Select inbound ports" 下拉在折叠态显示 "2 selected"（80 和 443 均已选中）
  const txt = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));
  const has2Selected = /2 selected/i.test(txt);
  const hasPort80 = /\b80\b/.test(txt);
  const hasPort443 = /\b443\b/.test(txt);
  const ok = has2Selected || hasPort80 || hasPort443;
  globalThis.__r.push({ sc: 'SC3', id: 'TC-NET-04', desc: '入站端口 80/443（2 selected）', ok,
    note: `has2Selected=${has2Selected} port80=${hasPort80} port443=${hasPort443}` });
  return JSON.stringify({ ok, has2Selected, hasPort80, hasPort443 });
}
```

---

## TC-NET-05　切换到现有 VNet lyx-vnet02

调用：`mcp_microsoft_pla_browser_run_code_unsafe`

```js
async (page) => {
  if (!globalThis.__r) globalThis.__r = [];
  // VNet 下拉（index 0）— 用 getBoundingClientRect 绕过 position:absolute 可见性问题
  const h0 = await page.evaluateHandle(() => {
    const all = [...document.querySelectorAll('.fxc-dropdown-open.azc-input,.fxc-dropdown-open')]
      .filter(el => { const r = el.getBoundingClientRect(); return (r.width > 0 || r.height > 0) && (el.textContent || '').trim().length > 0; });
    return all[0] || null;
  });
  const drop0 = h0.asElement();
  if (!drop0) { globalThis.__r.push({ sc: 'SC3', id: 'TC-NET-05', desc: '切换现有 VNet lyx-vnet02', ok: false, note: 'VNet 下拉未找到' }); return 'fail'; }
  await drop0.click(); await page.waitForTimeout(1000);

  // 用 .fxc-dropdown-option 遍历（[role="option"] 会匹配到 Portal 搜索历史隐藏元素）
  let selected = false;
  for (const opt of await page.locator('.fxc-dropdown-option').all()) {
    if (!await opt.isVisible().catch(() => false)) continue;
    if (/lyx-vnet02/i.test((await opt.textContent().catch(() => '')) || '')) { await opt.click(); selected = true; break; }
  }
  await page.waitForTimeout(2000);

  // 选择 default subnet
  if (selected) {
    const h1 = await page.evaluateHandle(() => {
      const all = [...document.querySelectorAll('.fxc-dropdown-open.azc-input,.fxc-dropdown-open')]
        .filter(el => { const r = el.getBoundingClientRect(); return (r.width > 0 || r.height > 0) && (el.textContent || '').trim().length > 0; });
      return all[1] || null;
    });
    const drop1 = h1.asElement();
    if (drop1) {
      await drop1.click(); await page.waitForTimeout(800);
      for (const opt of await page.locator('.fxc-dropdown-option').all()) {
        if (!await opt.isVisible().catch(() => false)) continue;
        if (/default/i.test((await opt.textContent().catch(() => '')) || '')) { await opt.click(); break; }
      }
    }
  }
  await page.waitForTimeout(1000);
  globalThis.__r.push({ sc: 'SC3', id: 'TC-NET-05', desc: '切换到现有 VNet lyx-vnet02', ok: selected, note: `selected=${selected}` });
  return JSON.stringify({ ok: selected });
}
```

---

## TC-NET-06　无效 VNet lyx-vnet01（/28 过小）— Portal 立即拒绝

> **实测行为：** 选择 `lyx-vnet01` 后，Portal **立即**（无需点击 Next）显示错误并将子网标记为 `Incompatible subnets`。  
> 预期错误关键词：`/27`、`address space`、`address prefix`、`Incompatible`、`capacity`

调用：`mcp_microsoft_pla_browser_run_code_unsafe`

```js
async (page) => {
  if (!globalThis.__r) globalThis.__r = [];
  const h0 = await page.evaluateHandle(() => {
    const all = [...document.querySelectorAll('.fxc-dropdown-open.azc-input,.fxc-dropdown-open')]
      .filter(el => { const r = el.getBoundingClientRect(); return (r.width > 0 || r.height > 0) && (el.textContent || '').trim().length > 0; });
    return all[0] || null;
  });
  const drop0 = h0.asElement();
  if (!drop0) { globalThis.__r.push({ sc: 'SC3', id: 'TC-NET-06', desc: '无效 VNet lyx-vnet01 被拒绝', ok: false, note: 'VNet 下拉未找到' }); return 'fail'; }
  await drop0.click(); await page.waitForTimeout(1000);

  let selected = false;
  for (const opt of await page.locator('.fxc-dropdown-option').all()) {
    if (!await opt.isVisible().catch(() => false)) continue;
    const t = (await opt.textContent().catch(() => '')) || '';
    // lyx-vnet01 但不是 lyx-vnet02
    if (/lyx-vnet01(?!02)/i.test(t)) { await opt.click(); selected = true; break; }
  }
  // 等待 Portal 立即显示错误（选 VNet 后即触发，无需点 Next）
  await page.waitForTimeout(2500);

  const errors = await page.evaluate(() => {
    const msgs = new Set();
    ['[role="alert"]','[class*="error"i]','[class*="validation"i]','[aria-live="assertive"]','[class*="incompatible"i]'].forEach(s =>
      document.querySelectorAll(s).forEach(el => {
        const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
        if (t && t.length > 5 && t.length < 500) msgs.add(t);
      })
    );
    return [...msgs];
  });

  const kw = /\/27|address space|address prefix|incompatible|subnet|capacity|not valid/i;
  let ok = errors.some(t => kw.test(t));

  // 兜底：若立即未显示，再尝试点 Next
  if (!ok) {
    const next = page.getByRole('button', { name: /^next$/i }).first();
    if (await next.isVisible({ timeout: 3000 }).catch(() => false)) {
      await next.click(); await page.waitForTimeout(3000);
      const e2 = await page.evaluate(() => {
        const msgs = new Set();
        ['[role="alert"]','[class*="error"i]','[aria-live="assertive"]'].forEach(s =>
          document.querySelectorAll(s).forEach(el => { const t = (el.innerText || '').replace(/\s+/g, ' ').trim(); if (t && t.length > 5 && t.length < 500) msgs.add(t); })
        );
        return [...msgs];
      });
      ok = e2.some(t => kw.test(t));
      errors.push(...e2);
    }
  }

  globalThis.__r.push({ sc: 'SC3', id: 'TC-NET-06', desc: 'lyx-vnet01（/28 过小）Portal 立即拒绝', ok,
    note: errors.slice(0, 2).join(' | ') });
  return JSON.stringify({ ok, errors: errors.slice(0, 3) });
}
```

截图存证：
```
mcp_microsoft_pla_browser_take_screenshot
path: sc4-screenshots/sc3-tc06-invalid-vnet.png
```

---

---

# SC4：Tags 验证

**前置条件：** 从 SC3 Networking 页进入 Tags 标签页。

---

## Step 4-0　进入 Tags 标签页

调用：`mcp_microsoft_pla_browser_run_code_unsafe`

```js
async (page) => {
  // 优先直接点击 Tags tab
  const tagsTab = page.getByRole('tab', { name: /^tags$/i }).first()
    .or(page.locator('a,button').filter({ hasText: /^tags$/i }).first());
  if (await tagsTab.isVisible({ timeout: 5000 }).catch(() => false)) {
    await tagsTab.click(); await page.waitForTimeout(2000); return 'tags-via-tab';
  }
  // 兜底：通过 Next 进入
  const next = page.getByRole('button', { name: /^next$/i }).first();
  await next.waitFor({ state: 'visible', timeout: 10000 }); await next.click(); await page.waitForTimeout(3000);
  return 'tags-via-next';
}
```

---

## Tags 操作核心规则

| # | 规则 | 原因 |
|---|------|------|
| 1 | Name 输入必须用 `pressSequentially({ delay: 80 })` | Name 受 Knockout.js observable 绑定，`fill()` 会被重置 |
| 2 | Name → Value 必须用 Tab，不能用 click | 直接 click Value 可能导致 KO 重渲染，input ID 失效 |
| 3 | Tab 前先按 Escape | 关闭 autocomplete 下拉，防止 Tab 导航到下拉项而非 Value |
| 4 | 提交行：点击下一行空编辑行的 Name input | 迫使当前行失焦并提交（display row 出现后才算提交成功） |
| 5 | Delete 按钮用 `row.getByRole('button', { name: 'Delete' })` | Delete 按钮无 `aria-label` HTML 属性，可访问名由 img alt 计算得来 |

---

## TC-TAG-01 ～ TC-TAG-04　正常添加标签

调用：`mcp_microsoft_pla_browser_run_code_unsafe`

```js
async (page) => {
  if (!globalThis.__r) globalThis.__r = [];
  const tags = [
    { key: 'env',          value: 'test',        id: 'TC-TAG-01' },
    { key: 'owner',        value: 'lyx',         id: 'TC-TAG-02' },
    { key: 'project-name', value: 'nginx/stage', id: 'TC-TAG-03' },
    { key: 'cost_center',  value: '123',         id: 'TC-TAG-04' },
  ];

  for (const { key, value, id } of tags) {
    try {
      const nameInputs = page.locator('input[aria-label="Name"]');
      const before = await nameInputs.count();
      const editInput = nameInputs.nth(before - 1);
      await editInput.click();
      // KO 绑定：必须 pressSequentially，不能 fill()
      await editInput.pressSequentially(key, { delay: 80 });
      await page.waitForTimeout(350);
      // Escape 关闭 autocomplete，再 Tab 到 Value
      await page.keyboard.press('Escape'); await page.waitForTimeout(100);
      await page.keyboard.press('Tab'); await page.waitForTimeout(400);
      // Value 输入框可用 keyboard.type
      await page.keyboard.type(value); await page.waitForTimeout(300);
      // 点击新出现的空编辑行提交当前行
      const after = await nameInputs.count();
      if (after > before) await nameInputs.nth(after - 1).click();
      await page.waitForTimeout(500);

      // 验证 display row（已提交行无 input 元素）
      const found = await page.evaluate(k =>
        [...document.querySelectorAll('[role="row"],tr')].some(r => r.textContent?.includes(k) && !r.querySelector('input'))
      , key);
      globalThis.__r.push({ sc: 'SC4', id, desc: `添加标签 ${key}=${value}`, ok: found, note: found ? '' : 'display row not found' });
    } catch (e) {
      globalThis.__r.push({ sc: 'SC4', id, desc: `添加标签 ${key}=${value}`, ok: false, note: e.message });
    }
  }
  return 'TC-TAG-01~04 done';
}
```

---

## TC-TAG-05　重复标签名 env → 错误提示

调用：`mcp_microsoft_pla_browser_run_code_unsafe`

```js
async (page) => {
  if (!globalThis.__r) globalThis.__r = [];
  const nameInputs = page.locator('input[aria-label="Name"]');
  const editInput = nameInputs.nth(await nameInputs.count() - 1);
  await editInput.click();
  await editInput.pressSequentially('env', { delay: 80 });
  await page.waitForTimeout(350);
  await page.keyboard.press('Escape'); await page.keyboard.press('Tab'); await page.waitForTimeout(800);

  const errText = await page.evaluate(() => {
    for (const el of document.querySelectorAll('[role="alert"],[aria-live="assertive"],[class*="error"i]')) {
      const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
      if (/already used|duplicate|invalid tag name/i.test(t)) return t;
    }
    return null;
  });
  const ok = !!errText;
  globalThis.__r.push({ sc: 'SC4', id: 'TC-TAG-05', desc: '重复标签名 env → 错误提示', ok, note: errText || '' });
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  return JSON.stringify({ ok, errText });
}
```

---

## TC-TAG-SPECIAL　Name 含 `<>?` → 不支持字符提示

调用：`mcp_microsoft_pla_browser_run_code_unsafe`

```js
async (page) => {
  if (!globalThis.__r) globalThis.__r = [];
  const nameInputs = page.locator('input[aria-label="Name"]');
  const editInput = nameInputs.nth(await nameInputs.count() - 1);
  await editInput.click();
  await editInput.pressSequentially('<>?', { delay: 80 });
  await page.waitForTimeout(350);
  await page.keyboard.press('Tab'); await page.waitForTimeout(600);

  const errText = await page.evaluate(() => {
    for (const el of document.querySelectorAll('[role="alert"],[aria-live="assertive"],[class*="error"i]')) {
      const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
      if (/not supported|<>%|invalid/i.test(t)) return t;
    }
    return null;
  });
  const ok = !!errText;
  globalThis.__r.push({ sc: 'SC4', id: 'TC-TAG-SPECIAL', desc: 'Name 含 "<>?" → 不支持字符提示', ok, note: errText || '' });
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  return JSON.stringify({ ok, errText });
}
```

---

## TC-TAG-EDIT　编辑 owner 值（lyx → yixueli）

调用：`mcp_microsoft_pla_browser_run_code_unsafe`

```js
async (page) => {
  if (!globalThis.__r) globalThis.__r = [];
  // 找 owner display row，点击进入 editing mode
  const rows = page.locator('[role="row"],tr');
  let idx = -1;
  for (let i = 0; i < await rows.count(); i++) {
    if ((await rows.nth(i).textContent().catch(() => '')).includes('owner')) { idx = i; break; }
  }
  if (idx === -1) {
    globalThis.__r.push({ sc: 'SC4', id: 'TC-TAG-EDIT', desc: '编辑 owner 值 → yixueli', ok: false, note: 'owner row not found' });
    return 'owner row not found';
  }
  await rows.nth(idx).click(); await page.waitForTimeout(500);
  // Value 输入框
  const valueInput = page.locator('input[aria-label="Value"]').first();
  await valueInput.click({ clickCount: 3 }); await page.keyboard.type('yixueli'); await page.waitForTimeout(300);
  // 提交
  const nameInputs = page.locator('input[aria-label="Name"]');
  await nameInputs.last().click(); await page.waitForTimeout(500);

  const rowText = await page.evaluate(() =>
    ([...document.querySelectorAll('[role="row"],tr')].find(r => r.textContent?.includes('owner'))?.textContent || '').replace(/\s+/g, ' ').trim()
  );
  const ok = rowText.includes('yixueli');
  globalThis.__r.push({ sc: 'SC4', id: 'TC-TAG-EDIT', desc: '编辑 owner 值 → yixueli', ok, note: rowText });
  return JSON.stringify({ ok, rowText });
}
```

---

## TC-TAG-DEL　删除 cost_center 行

调用：`mcp_microsoft_pla_browser_run_code_unsafe`

```js
async (page) => {
  if (!globalThis.__r) globalThis.__r = [];
  const rows = page.locator('[role="row"],tr');
  let idx = -1;
  for (let i = 0; i < await rows.count(); i++) {
    if ((await rows.nth(i).textContent().catch(() => '')).includes('cost_center')) { idx = i; break; }
  }
  if (idx === -1) {
    globalThis.__r.push({ sc: 'SC4', id: 'TC-TAG-DEL', desc: '删除 cost_center 行', ok: false, note: 'cost_center row not found' });
    return 'cost_center row not found';
  }
  // Delete 按钮通过无障碍 API（不能用 aria-label 属性，可访问名由 img alt 计算）
  await rows.nth(idx).getByRole('button', { name: 'Delete' }).click();
  await page.waitForTimeout(500);

  const stillExists = await page.evaluate(() =>
    [...document.querySelectorAll('[role="row"],tr')].some(r => r.textContent?.includes('cost_center'))
  );
  const ok = !stillExists;
  globalThis.__r.push({ sc: 'SC4', id: 'TC-TAG-DEL', desc: '删除 cost_center 行', ok, note: `stillExists=${stillExists}` });
  return JSON.stringify({ ok, stillExists });
}
```

---

## TC-TAG-REVIEW　进入 Review+Create 验证摘要

调用：`mcp_microsoft_pla_browser_run_code_unsafe`

```js
async (page) => {
  if (!globalThis.__r) globalThis.__r = [];
  await page.getByRole('button', { name: /review.*create/i }).first().click();
  await page.waitForTimeout(4000);

  const txt = await page.evaluate(() => {
    const panel = document.querySelector('[role="tabpanel"]') || document.body;
    return (panel.innerText || '').replace(/\s+/g, ' ').trim();
  });

  const hasError   = /validation failed|required information|not valid/i.test(txt);
  const hasSub     = /Liftr-Nginx-Test/i.test(txt);
  const hasRG      = /lyx-liftr-test/i.test(txt);
  const hasRegion  = /West Central US/i.test(txt);
  const hasEnv     = /\benv\b/i.test(txt);
  const hasOwner   = /\byixueli\b/i.test(txt);  // 编辑后的值
  const hasProj    = /project-name/i.test(txt);
  const noCost     = !/cost_center/i.test(txt);  // 已删除

  const ok = !hasError && hasSub && hasRG && hasRegion && hasEnv && hasOwner && hasProj && noCost;
  globalThis.__r.push({
    sc: 'SC4', id: 'TC-TAG-REVIEW', desc: 'Review+Create 摘要验证', ok,
    note: `err=${hasError} sub=${hasSub} rg=${hasRG} region=${hasRegion} env=${hasEnv} owner=${hasOwner} proj=${hasProj} noCost=${noCost}`
  });
  return JSON.stringify({ ok, hasError, hasSub, hasRG, hasRegion, hasEnv, hasOwner, hasProj, noCost });
}
```

截图存证：
```
mcp_microsoft_pla_browser_take_screenshot
path: sc4-screenshots/sc4-review-create.png
```

---

---

# 最终汇总表格输出

所有 TC 执行完毕后，调用一次 `mcp_microsoft_pla_browser_run_code_unsafe`：

```js
async (page) => {
  const results = globalThis.__r || [];
  const pass = results.filter(r => r.ok).length;
  const fail = results.filter(r => !r.ok).length;

  let md = '\n## NGINXaaS SC1-SC4 MCP 测试结果\n\n';
  md += '| 场景 | TC ID | 描述 | 状态 | 备注 |\n';
  md += '|------|-------|------|------|------|\n';
  for (const r of results) {
    const icon = r.ok ? '✅ PASS' : '❌ FAIL';
    const note = (r.note || '').substring(0, 80).replace(/\|/g, '\\|');
    md += `| ${r.sc} | ${r.id} | ${r.desc} | ${icon} | ${note} |\n`;
  }
  md += `\n**总计：✅ ${pass} PASS　❌ ${fail} FAIL　共 ${results.length} 项**\n`;
  console.log(md);
  return md;
}
```

---

## 常见失败处理

| 症状 | 原因 | 处理 |
|------|------|------|
| Step 1-2 超时 | Edge 会话过期，卡在登录页 | 手动在浏览器中完成登录，再继续执行 Step 1-3 |
| SC2 Name 输入框找不到 | SC1 失败，页面不在 Basics | 重新执行 Step 1-3 到 1-5，再执行 SC2 |
| VNet 下拉 `waitFor visible` 超时 | `position: absolute` 元素 | 使用 `evaluateHandle` + `getBoundingClientRect` 绕过 |
| `[role="option"]` 匹配到搜索历史 | Portal 搜索历史也带 `role="option"` | 改用 `.fxc-dropdown-option` 类遍历 |
| TC-NET-03 无法点击 Private Only | radio 选择器不匹配 | 检查 `[role="radio"]` 实际文本，更新 filter |
| Tags Name 输入被清空 | Knockout.js observable | 确认使用 `pressSequentially({ delay: 80 })` |
| Delete 按钮点击无效 | 选择器用了 `aria-label` 属性 | 改用 `row.getByRole('button', { name: 'Delete' })` |
| TC-NET-06 未立即显示错误 | Portal 版本差异 | 代码已内置兜底：点击 Next 后再收集错误 |
