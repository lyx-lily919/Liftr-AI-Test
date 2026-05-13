# NginxaaS Azure Portal 自动化测试 Skill

## 概述

本 Skill 描述如何使用 Playwright + Microsoft Edge 对 Azure Portal 上的 NginxaaS 服务进行自动化测试，包括登录、搜索、进入创建向导、填写 Basics、通过 Networking 和 Tags，并在 Review + create 页面截图的完整流程。

---

## 环境要求

| 依赖 | 版本要求 |
|------|----------|
| Node.js | >= 18 |
| Playwright | >= 1.59 |
| 浏览器 | Microsoft Edge (msedge channel) |

安装依赖：
```bash
npm install playwright
```

---

## 测试目标 URL

```
https://portal.azure.com/?feature.customportal=false
  &feature.canmodifystamps=true
  &Azure_Marketplace_Nginx=stage1
  &Azure_Marketplace_Nginx_assettypeoptions={"Nginx":{"options":""}}
  &microsoft_azure_marketplace_ItemHideKey=Azure_Marketplace_NGINX
  #home
```

此 URL 包含以下 Feature Flags：
- `feature.customportal=false` — 关闭自定义门户
- `feature.canmodifystamps=true` — 允许修改 stamps
- `Azure_Marketplace_Nginx=stage1` — 启用 NginxaaS stage1 环境
- `microsoft_azure_marketplace_ItemHideKey=Azure_Marketplace_NGINX` — 显示隐藏的 NginxaaS Marketplace 项

---

## 测试步骤详解

### Step 1：启动 Microsoft Edge 浏览器

使用 `launchPersistentContext` 而非 `launch`，以便复用浏览器会话（Cookie/Token），从而触发账号选择器。

```js
const context = await chromium.launchPersistentContext(profileDir, {
  channel: 'msedge',
  headless: false,
  viewport: null,
  args: ['--start-maximized', '--no-first-run', '--no-default-browser-check'],
});
```

**关键点：**
- 优先尝试系统 Edge 配置文件目录（`%LOCALAPPDATA%\Microsoft\Edge\User Data`）
- 若系统配置文件被占用（Edge 已打开），自动 fallback 到项目内独立测试目录（`.edge-test-profile`）
- 独立测试目录首次运行时会触发登录，登录后会话被持久化，后续运行无需重新登录

---

### Step 2：导航到 Azure Portal URL

```js
await page.goto(AZURE_PORTAL_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
```

**关键点：**
- 使用 `domcontentloaded` 而非 `networkidle`，避免 Portal 大量后台请求导致超时

---

### Step 3：处理登录 / 账号选择流程

Microsoft 登录页面存在多种状态，需逐一检测处理：

#### 情况 A：账号选择器（Pick an account）— 有缓存会话时出现

```js
// 通过 data-test-id 精确定位目标账号 tile
await page.locator(`[data-test-id="${targetAccount}"]`).click();
```

#### 情况 A2：账号文字列表

```js
await page.locator(`text="${targetAccount}"`).first().click();
```

#### 情况 B：邮箱输入框（无缓存会话）

```js
await page.locator('input[name="loginfmt"]').fill(targetAccount);
await page.locator('input[type="submit"][value="Next"]').click();
// 后续等待企业 SSO 跳转，无需额外操作
```

#### 情况 C："Stay signed in?" 提示

```js
await page.locator('input[id="idSIButton9"][value="Yes"]').click();
```

**关键点：**
- 使用循环最多检测 3 次，每次间隔 2 秒
- 每次循环先判断当前 URL 是否已离开 `login.microsoftonline.com`，离开则退出循环
- 各情况判断都使用 `isVisible({ timeout: 3000 })` + `.catch(() => false)` 防止超时报错

---

### Step 4：等待 Azure Portal 首页加载

```js
await page.waitForSelector(
  '[role="combobox"][aria-label*="Search"], input[aria-label*="Search resources"]',
  { timeout: 120000 }
);
```

**关键点：**
- 等待顶部搜索框出现，是 Portal 首页完全加载的可靠信号
- 超时设置 120 秒，因为 Portal 首次加载较慢

---

### Step 5：搜索 NGINXaaS

```js
const searchBox = page.locator('[role="combobox"][aria-label*="Search"]').first();
await searchBox.click();
// 必须使用 pressSequentially，fill() 不会触发 Portal 的搜索事件处理器
await searchBox.pressSequentially('nginxaas', { delay: 80 });
// 等待搜索结果下拉出现
await page.waitForSelector('[role="listbox"] [role="option"]', { timeout: 10000 });
```

**关键点：**
- **必须使用 `pressSequentially` 而非 `fill`**：`fill` 直接设置 value 不触发 input 事件，导致 Portal 搜索不响应
- `delay: 80` 模拟人工输入速度，确保每个字符触发事件
- 等待 `[role="listbox"] [role="option"]` 出现，确认搜索结果已渲染

---

### Step 6：点击 NGINXaaS 服务（Services 分类）

```js
// 使用正则精确匹配，避免误选 "F5 NGINXaaS – SaaS Load Balancer..." Marketplace 项
await page.locator('[role="option"]').filter({ hasText: /^NGINXaaS$/ }).first().click();
```

**关键点：**
- 搜索结果分为 **Services**、**Marketplace**、**Documentation** 三个分类
- Services 下的 "NGINXaaS" 是精确字符串，Marketplace 项包含更长的描述文字
- 使用 `/^NGINXaaS$/` 正则精确匹配，避免误点 Marketplace 项

---

### Step 7：等待 NGINXaaS 资源列表页加载

```js
// Azure Portal 使用 hash 路由（#browse/NGINX...），waitForURL 无法检测 hash 变化
// 改为等待资源列表 iframe 出现
await page.waitForSelector('iframe[name="BrowseResource.ReactView"]', { timeout: 30000 });
await page.waitForTimeout(3000); // 等待 iframe 内容完全渲染
```

**关键点：**
- **不能使用 `waitForURL`**：Azure Portal 路由基于 hash（`#browse/...`），Playwright 的 `waitForURL` 无法检测 hash 变化
- 改为等待 `iframe[name="BrowseResource.ReactView"]` 出现，这是列表页内容容器
- iframe 出现后需额外等待 3 秒，确保内部 React 组件渲染完毕

---

### Step 8：点击 Create 按钮

```js
// Azure Portal 资源列表内容在 iframe 内，必须通过 frameLocator 访问
const createBtn = page
  .frameLocator('iframe[name="BrowseResource.ReactView"]')
  .locator('[role="menuitem"]:has-text("Create")');

await createBtn.waitFor({ state: 'visible', timeout: 30000 });
await createBtn.click();
```

**关键点：**
- Create 按钮位于 `BrowseResource.ReactView` iframe 内，直接在 page 上查找会失败
- 使用 `frameLocator()` 穿透 iframe（Playwright 推荐方式），无需手动获取 frame 对象
- 点击前先 `waitFor({ state: 'visible' })` 确保按钮已渲染

---

### Step 9：等待创建页面加载

```js
// 等待 URL 变为创建页面（hash 包含 create/f5-networks）
await page.waitForURL(/create\/f5-networks/i, { timeout: 30000 });
await page.waitForTimeout(4000); // 等待表单控件渲染
```

**关键点：**
- 创建页面跳转属于完整 URL 跳转（非 hash 内跳转），`waitForURL` 可正常检测
- 进入创建页面后先等待 4 秒，确保 Marketplace 表单控件完全加载，再继续操作 Basics 表单

---

### Step 10：确认并切换到 Basics 标签页

进入 Create NGINXaaS 页面后，默认应在 **Basics** 标签页。Azure Portal 当前实现中该标签通常是普通 `<a>` 或 `<button>`，而不一定带 `role="tab"`。

```js
// 等待 Basics 表单内容渲染完成
await page.waitForSelector('text=Project details', { timeout: 30000 });

const basicsTabLink = page.locator('a:has-text("Basics"), button:has-text("Basics")').first();
const basicsLinkExists = await basicsTabLink.isVisible({ timeout: 3000 }).catch(() => false);

if (basicsLinkExists) {
  const ariaSel = await basicsTabLink.getAttribute('aria-selected').catch(() => null);
  const cls = await basicsTabLink.getAttribute('class').catch(() => '');
  const isActive = ariaSel === 'true' || (cls || '').toLowerCase().includes('select') || (cls || '').toLowerCase().includes('active');

  if (!isActive && ariaSel !== null) {
    await basicsTabLink.click();
    await page.waitForTimeout(1000);
  }
}
```

**关键点：**
- 用 `text=Project details` 作为 Basics 页面已渲染的稳定信号，比等待 tablist 更可靠
- Basics 标签当前常表现为普通链接或按钮，因此脚本同时兼容 `<a>` 和 `<button>`
- 激活态优先看 `aria-selected`，其次兜底检查 `class` 是否包含 `select` 或 `active`

---

### Step 11：验证并选择 Subscription

检查 Subscription 字段附近文本是否已包含 `Liftr-Nginx-Test`；若不是，则通过 label 反向定位到真正的下拉控件并选择目标订阅。

```js
const TARGET_SUBSCRIPTION = 'Liftr-Nginx-Test';

await page.keyboard.press('Escape');
await page.waitForTimeout(500);

const subCorrect = await page.evaluate((target) => {
  const lbl = [...document.querySelectorAll('label')]
    .find(l => /^Subscription/.test(l.textContent?.trim()));
  if (!lbl) return false;
  let el = lbl.parentElement;
  for (let i = 0; i < 5; i++) {
    if (!el) break;
    if (el.textContent?.includes(target)) return true;
    el = el.parentElement;
  }
  return false;
}, TARGET_SUBSCRIPTION);

if (!subCorrect) {
  await page.evaluate(() => {
    const lbl = [...document.querySelectorAll('label')]
      .find(l => /^Subscription/.test(l.textContent?.trim()));
    if (!lbl) return;
    let el = lbl.parentElement;
    for (let i = 0; i < 6; i++) {
      if (!el) break;
      const ctrl = el.querySelector('button[aria-haspopup="listbox"], [role="combobox"]');
      if (ctrl) {
        ctrl.click();
        return;
      }
      el = el.parentElement;
    }
  });
  await page.waitForTimeout(800);
  await page.locator('[role="option"]').filter({ hasText: TARGET_SUBSCRIPTION }).first().click();
  await page.waitForTimeout(2000);
}
```

**关键点：**
- 先按一次 `Escape` 关闭可能残留的 Portal 弹层，避免挡住 Subscription 控件
- 脚本不是直接依赖 `aria-label*="Subscription"`，而是通过 `label` 文本向上遍历父容器，更适合当前 Portal DOM
- 真正点击的目标限定为 `button[aria-haspopup="listbox"]` 或 `[role="combobox"]`，可避开信息图标等非下拉元素

---

### Step 12：验证并选择 Resource Group

检查 Resource group 字段附近文本是否为 `lyx-liftr-test`；若不是，则打开 Resource group 下拉并通过过滤输入框选择目标值。

```js
const TARGET_RESOURCE_GROUP = 'lyx-liftr-test';

const rgCorrect = await page.evaluate((target) => {
  const lbl = [...document.querySelectorAll('label')]
    .find(l => /^Resource group/.test(l.textContent?.trim()));
  if (!lbl) return false;
  let el = lbl.parentElement;
  for (let i = 0; i < 5; i++) {
    if (!el) break;
    if (el.textContent?.includes(target)) return true;
    el = el.parentElement;
  }
  return false;
}, TARGET_RESOURCE_GROUP);

if (!rgCorrect) {
  const rgDropDiv = page.locator('div[aria-label="Create new or use existing Resource group"]');
  await rgDropDiv.waitFor({ state: 'visible', timeout: 10000 });
  await rgDropDiv.click();
  await page.waitForTimeout(800);

  const rgFilterInput = page.locator(
    'input[aria-label="Type to filter result or use down arrow to choose options"]'
  ).nth(1);
  await rgFilterInput.waitFor({ state: 'visible', timeout: 8000 });
  await rgFilterInput.click();
  await rgFilterInput.pressSequentially(TARGET_RESOURCE_GROUP, { delay: 50 });
  await page.waitForTimeout(1000);
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(400);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1000);
}
```

**关键点：**
- 当前脚本依赖 Resource group 容器的 `aria-label="Create new or use existing Resource group"` 作为展开入口
- 过滤输入框会同时保留之前字段的 DOM，脚本用 `.nth(1)` 选中 Resource group 对应输入框
- 输入后使用 `ArrowDown` + `Enter` 选择首个匹配项，比直接查找 `[role="option"]` 更稳定

---

### Step 13：填写 Name 字段

根据当天日期生成实例名称，格式为 `lyx-stage-MMDD`（例如 4 月 28 日为 `lyx-stage-0428`），填入 Name 输入框。

```js
const now = new Date();
const instanceName = `lyx-stage-${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
// 通过 JS 读取 label[for] 属性获取 input 的 ID，避免 getByLabel 匹配到非 input 的包裹元素
const nameInputId = await page.evaluate(() => {
  const label = [...document.querySelectorAll('label')]
    .find(l => /^Name\b/.test((l.textContent || '').trim()));
  return label?.htmlFor || null;
});
const nameInput = nameInputId
  ? page.locator(`[id="${nameInputId}"]`)
  : page.locator('input[type="text"]').filter({ hasNot: page.locator('[aria-haspopup]') }).first();
await nameInput.waitFor({ state: 'visible', timeout: 10000 });
await nameInput.click({ clickCount: 3 }); // 全选已有内容
await nameInput.fill(instanceName);
```

**关键点：**
- **不能直接用 `getByLabel(/^Name$/i)`**：Playwright 的 `getByLabel` 会匹配所有与该 label 关联的元素，Azure Portal 表单中 label 的直接父级是 div 容器，导致匹配到非 input 元素报错
- 正确做法：在 page 上下文中读取 `label.htmlFor`，拿到 input 的 ID，再用 `[id="..."]` 属性选择器精确定位 input
- 月份和日期均使用 `padStart(2, '0')` 补零，确保格式固定为 4 位（`0428`）
- `click({ clickCount: 3 })` 全选已有内容，再 `fill()` 覆盖，避免残留字符

---

### Step 14：检查并设置 Region

检查 Region 下拉框当前值是否为 `West Central US`，若是则保持默认，若不是则搜索并选中。

```js
const TARGET_REGION = 'West Central US';

// 通过 label "Region" 向上遍历父容器，找到 button[aria-haspopup="listbox"]
const regionDropBtn = await page.evaluateHandle(() => {
  const lbl = [...document.querySelectorAll('label')]
    .find(l => /^Region\b/.test((l.textContent || '').trim()));
  if (!lbl) return null;
  let el = lbl.parentElement;
  for (let i = 0; i < 6; i++) {
    if (!el) break;
    const btn = el.querySelector('button[aria-haspopup="listbox"], [role="combobox"]');
    if (btn) return btn;
    el = el.parentElement;
  }
  return null;
});

const regionBtnElement = regionDropBtn.asElement();
// 读取 aria-controls，定位弹出容器（只包含过滤输入框，不含选项列表）
const controlsId = await regionBtnElement.getAttribute('aria-controls');
await regionBtnElement.click();
await page.waitForTimeout(800);

// 在弹出容器内定位过滤输入框（避免误操作 Portal 顶部全局搜索框）
const popup = page.locator(`#${controlsId}`);
await popup.waitFor({ state: 'visible', timeout: 5000 });
const filterInput = popup.locator('input').first();
await filterInput.click();

// 输入 "West central us" 精确过滤，排除 "(Europe) Germany West Central"
await filterInput.pressSequentially('West central us', { delay: 80 });
await page.waitForTimeout(1000);

// 将 ArrowDown/Enter 发给 filterInput 而非 page，确保键盘事件到达下拉处理器
// 选项列表由 Fluent UI 渲染在 body 根层级（Callout），无法通过 DOM 选择器找到
await filterInput.press('ArrowDown');
await page.waitForTimeout(500);
await filterInput.press('Enter');
```

**关键点：**
- **通过 label 定位下拉按钮**，而非依赖脆弱的 XPath ID（`_weave_e_1410` 每次渲染会变化）
- **`aria-controls`** 指向弹出容器（如 `form-label-id-11dialog`），该容器只含过滤输入框，**不含选项列表**
- **选项列表**由 Fluent UI 的 Callout 渲染在 body 根层级，无法通过 `[role="option"]`、`getByRole`、`getByText` 找到——这些方法在此场景下均无效
- **正确做法**：过滤框输入后，用 `filterInput.press('ArrowDown')` 将键盘事件发给过滤框本身（而非 `page.keyboard.press`），再 `filterInput.press('Enter')` 确认，选中过滤结果第一项
- **搜索词用 `'West central us'`（含 "us"）**，可精确过滤出 `(US) West Central US`，排除 `(Europe) Germany West Central`
- 操作完成后用 `page.evaluate` 验证 Region label 附近文字包含目标值（`Region 验证: OK`）

---

### Step 15：选择 Pricing Plan（Standard v3）

点击 `Select pricing plan` 按钮，打开 Plan 选择面板，找到 **Standard v3**（非 Standard v3 Test）行并选中，最后点击 `Confirm Plan` 按钮确认。

```js
const pricingPlanBtn = page.locator('text=Select pricing plan').first();
await pricingPlanBtn.waitFor({ state: 'visible', timeout: 15000 });
await pricingPlanBtn.click();
await page.waitForTimeout(2500);

const standardV3Row = page.locator('[role="row"], tr, li')
  .filter({ hasText: /Standard V3/i })
  .filter({ hasNotText: /Test|TESTING/i })
  .first();
await standardV3Row.waitFor({ state: 'visible', timeout: 15000 });
const radioInRow = standardV3Row.locator('input[type="radio"]');
const radioCount = await radioInRow.count();
if (radioCount > 0) {
  await radioInRow.click();
} else {
  await standardV3Row.click();
}
await page.waitForTimeout(1000);

const confirmPlanBtn = page.locator('text=Confirm Plan').first();
await confirmPlanBtn.waitFor({ state: 'visible', timeout: 15000 });
await confirmPlanBtn.click();
await page.waitForTimeout(2000);
```

**关键点：**
- `Select pricing plan` 和 `Confirm Plan` 在 Portal 中不一定是 `<button>`，直接用 `text=` 匹配更符合当前实现
- 使用两层 `filter`：先匹配 `Standard V3`，再排除包含 `Test` 或 `TESTING` 的候选项，避免误选测试套餐
- 仍优先点击行内 radio，若不存在再点击整行兜底

---

### Step 16：点击 Next 进入 Networking 页面

完成 Basics 页面所有字段填写后，点击底部 `Next` 按钮跳转到 Networking 标签页。

```js
const nextBtn = page.locator('button:has-text("Next")').first();
await nextBtn.waitFor({ state: 'visible', timeout: 10000 });
await nextBtn.click();
await page.waitForTimeout(4000);
```

**关键点：**
- 脚本实际使用 `page.getByRole('button', { name: /^next$/i })`，以兼容 Portal 中按钮文本大小写差异
- 点击后等待 4 秒，确保 Networking 页面复选框等异步内容已完成渲染

---

### Step 17：勾选 Networking 页面复选框

进入 Networking 页面后，脚本会定位虚拟网络访问相关复选框，点击后立即验证勾选状态。

```js
const vnetAccessSpan = page.locator(
  'xpath=/html/body/div[1]/div[4]/div[1]/div[1]/main/div[3]/div[2]/section[2]/div[2]/div[1]/div[4]/div[2]/div/div/div[2]/div/div[2]/div[2]/div/div[2]/div/div[3]/div[3]/div[2]/div[2]/div/div/span'
).first();

await vnetAccessSpan.waitFor({ state: 'visible', timeout: 30000 });
await vnetAccessSpan.scrollIntoViewIfNeeded().catch(() => {});
await vnetAccessSpan.click();
await page.waitForTimeout(1000);

const fallbackCheckbox = page.locator('input[type="checkbox"]').last();
const fallbackSelected = await fallbackCheckbox.isChecked().catch(() => false);
const spanAriaChecked = await vnetAccessSpan.getAttribute('aria-checked').catch(() => null);

if (!(fallbackSelected || spanAriaChecked === 'true')) {
  throw new Error('Networking checkbox was not selected');
}
```

**关键点：**
- 当前 Portal 这一项仍通过绝对 XPath 定位，说明该页面结构比 Basics 区域更脆弱
- 点击后同时检查 `input[type="checkbox"]` 和 `span[aria-checked]` 两种状态来源，避免只看单一 DOM 信号
- 若验证失败，脚本会直接抛错并进入错误截图分支，避免误继续后续页面

---

### Step 18：点击 Next 进入 Tags 页面

完成 Networking 设置后，再次点击 `Next` 进入 Tags 页面。

```js
const nextBtnOnNetworkingPage = page.getByRole('button', { name: /^next$/i }).first();
await nextBtnOnNetworkingPage.waitFor({ state: 'visible', timeout: 20000 });
await nextBtnOnNetworkingPage.click();
await page.waitForTimeout(3000);
```

**关键点：**
- 与 Basics 页面的 Next 按钮定位方式保持一致，减少选择器分叉
- 等待 3 秒即可，因为 Tags 页面通常比 Networking 页面更轻量

---

### Step 19：点击 Next 进入 Review + create 页面

Tags 页面无需填写内容时，直接点击 `Next` 进入 `Review + create` 页面。

```js
const nextBtnOnTagsPage = page.getByRole('button', { name: /^next$/i }).first();
await nextBtnOnTagsPage.waitFor({ state: 'visible', timeout: 20000 });
await nextBtnOnTagsPage.click();
await page.waitForTimeout(4000);
```

**关键点：**
- 当前自动化流程没有在 Tags 页面填写任何键值对，因此只做页面跳转
- 跳到 `Review + create` 后等待 4 秒，让最终摘要区域稳定下来再截图

---

### Step 20a：检查 Review + create 页面顶部的校验失败提示

进入 `Review + create` 页面后，**优先检查页面顶部是否出现红色报错横幅**，例如：

> **Validation failed. Required information is missing or not valid.**

若出现该提示，则说明表单存在必填项缺失或格式错误，页面底部的 `Create` 按钮会处于**灰色不可点击**状态。脚本此时将抛错并提示用户手动排查。

```js
const validationErrorPatterns = [
  'text=Validation failed',
  'text=Required information is missing or not valid',
  '[class*="error"] >> text=/validation failed|required information/i',
  '[role="alert"] >> text=/validation failed|required information/i',
];
let validationErrorMsg = '';
for (const pattern of validationErrorPatterns) {
  const el = page.locator(pattern).first();
  if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
    validationErrorMsg = await el.innerText().catch(() => pattern);
    break;
  }
}
if (validationErrorMsg) {
  throw new Error(
    `[20a] Review + create 页面顶部出现校验失败提示，Create 按钮不可点击。\n` +
    `提示内容：${validationErrorMsg.trim()}\n` +
    `请检查表单填写是否有误（Subscription / Resource group / Name / Region / Pricing Plan 等）。`
  );
}
```

**关键点：**
- 使用 4 种选择器模式互相回退，确保不同版本 Portal 均可检测到错误提示
- 若无报错提示，说明 `Create` 按钮为蓝色可点击状态，继续进行字段校验
- 若有报错提示，脚本立即抛错并通过错误截图 `nginxaas-error.png` 保存当前页面状态

---

### Step 20b：校验 Review + create 页面字段

确认无校验失败提示后，逐项核对 Basics 摘要字段是否与前面创建流程中的选择一致。

```js
await assertReviewFieldContains(page, /^Subscription\b/, TARGET_SUBSCRIPTION);
await assertReviewFieldContains(page, /^Resource group\b/, TARGET_RESOURCE_GROUP);
await assertReviewFieldContains(page, /^Name\b/, instanceName);
await assertReviewFieldContains(page, /^Region\b/, TARGET_REGION);
await assertReviewFieldContains(page, /^Pricing Plan\b/, 'Standard V3, Monthly');
await assertReviewFieldContains(page, /^Scaling\b/, selectedScaling);
await assertReviewFieldContains(page, /^Upgrade Channel\b/, selectedUpgradeChannel);
```

**关键点：**
- Subscription、Resource group、Name、Region、Pricing Plan 直接和流程中的预期值比对
- Scaling 和 Upgrade Channel 先在 Basics 页面读取当前选中值，再在 Review 页检查摘要中是否一致
- 若任一字段校验失败，脚本应直接抛错并进入错误截图分支，避免生成误导性的成功截图

---

### Step 21：点击 Create 并等待部署完成

校验无误后，点击 `Review + create` 页面下方的 `Create` 按钮，随后等待部署完成。脚本默认最长等待 20 分钟，并支持环境变量覆盖。

```js
const createFinalBtn = page.getByRole('button', { name: /^create$/i }).first();
await createFinalBtn.waitFor({ state: 'visible', timeout: 30000 });
await createFinalBtn.click();

const DEPLOYMENT_TIMEOUT_MINUTES = Number(process.env.DEPLOYMENT_TIMEOUT_MINUTES || 20);
const goToResourceButton = await waitForDeploymentCompletion(page, DEPLOYMENT_TIMEOUT_MINUTES * 60 * 1000);
```

**关键点：**
- 如果上一阶段字段校验出错，脚本应立即中断并提示具体不匹配字段
- 部署完成前不应提前点击其他页面元素，避免干扰 Portal 的部署流程
- `waitForDeploymentCompletion` 默认使用 20 分钟超时；若环境较慢可设置 `DEPLOYMENT_TIMEOUT_MINUTES=30`
- 等待期间脚本会定期刷新页面，确保能看到最新部署状态和 `Go to resource` 按钮

---

### Step 22：点击蓝色 Go to resource 按钮

部署完成后，点击部署页面右侧或下方的蓝色 `Go to resource` 按钮，跳转到最终资源页面。

```js
await goToResourceButton.click();
await page.waitForLoadState('domcontentloaded').catch(() => {});
await page.waitForTimeout(3000);
```

**关键点：**
- `Go to resource` 一般只会在部署成功后出现，出现即代表可以进入资源页
- 点击后等待页面稳定，再做后续截图或人工确认

---

### Step 23：在最终资源页面截图

最终截图发生在点击 `Go to resource` 后的资源页面，而不是刚进入 `Review + create` 页面时。

```js
const SCREENSHOT_PATH = path.join(__dirname, 'nginxaas-review-create-edge.png');
await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false });
```

**关键点：**
- 截图时机是资源创建完成并跳转到目标资源之后，便于确认部署已真正落地
- `fullPage: false` 仅保留当前视口，避免 Portal 长页面带来过大的截图文件

---

## 常见问题与解决方案

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| 等待 Portal 首页超时 | 新会话/无 Cookie，需先完成登录 | 使用 `launchPersistentContext` 持久化会话 |
| 搜索框输入后无搜索结果 | `fill()` 不触发 Portal input 事件 | 改用 `pressSequentially({ delay: 80 })` |
| 点击 NGINXaaS 后 `waitForURL` 超时 | Azure Portal 使用 hash 路由 | 改为等待 `iframe[name="BrowseResource.ReactView"]` |
| Create 按钮找不到 | 按钮在 iframe 内 | 使用 `page.frameLocator('iframe[name="BrowseResource.ReactView"]')` |
| 系统 Edge 配置文件不可用 | Edge 浏览器已打开占用配置文件 | 自动 fallback 到项目内 `.edge-test-profile` 目录 |
| 搜索到 Marketplace 的 NGINXaaS | `has-text` 匹配了更长的描述文字 | 使用 `.filter({ hasText: /^NGINXaaS$/ })` 精确匹配 |
| 找不到 Basics 标签 | 创建页面渲染为普通链接/按钮而不是 `role="tab"` | 先等待 `text=Project details`，再用 `a:has-text("Basics"), button:has-text("Basics")` 定位 |
| Subscription 下拉定位失败 | 直接用 `aria-label` 选不到实际控件 | 先通过 `label` 文本找到字段，再向上遍历父容器定位 `button[aria-haspopup="listbox"]` |
| Resource group 列表为空 | Subscription 切换后列表尚未刷新 | 在 Subscription 选择后增加 `waitForTimeout(2000)` 再操作 Resource group |
| Name 输入框定位失败 | `getByLabel` 匹配到 label 的 div 父容器而非 input | 用 `page.evaluate` 读取 `label.htmlFor`，再用 `[id="..."]` 定位 input |
| Region 下拉定位失败（超时） | 下拉按钮和选项列表分别由不同层级渲染 | 通过 `label` 找按钮，读取 `aria-controls` 找过滤框，再对过滤框发送 `ArrowDown` / `Enter` |
| Select pricing plan 定位失败 | 该元素不是标准 `<button>` | 使用 `page.locator('text=Select pricing plan')` 匹配任意含该文字的叶子节点 |
| Standard v3 行找不到 | Plan 面板使用了不同的 HTML 结构 | 用 DevTools 检查实际结构，调整选择器（如 `div[role="radio"]` 等） |
| Confirm Plan 按钮点击后无响应 | Plan 未被选中（radio 未激活） | 确认 radio 状态为 checked 后再点击 Confirm Plan |
| Networking 复选框勾选失败 | 页面控件结构变化或点击未生效 | 点击后同时检查 `input[type="checkbox"]` 和 `aria-checked`，必要时重新抓取控件定位 |
| 点击 Create 后长时间没有完成 | 部署仍在进行或 Portal 页面较慢 | 增加 `DEPLOYMENT_TIMEOUT_MINUTES`（例如 30），并保持页面刷新策略 |
| `Go to resource` 按钮找不到 | 部署失败或页面未刷新到完成状态 | 查看页面上的失败提示，或等待更久后重试 |
| Next 按钮点击后页面无变化 | 表单存在验证错误 | 查看 `nginxaas-error.png` 或当前页面提示，修正字段后重试 |

---

## 项目文件结构

```
Liftr-AI-Test02/
├── test-nginxaas.js          # 主测试脚本
├── package.json              # Node.js 依赖配置
├── stage-create/
│   └── SKILL.md              # 本文件：测试知识与最佳实践
├── .edge-test-profile/       # Edge 独立测试配置文件（首次运行后自动生成）
├── nginxaas-review-create-edge.png # 测试截图（成功时生成）
└── nginxaas-error.png        # 错误截图（失败时生成）
```

---

## 执行命令

```bash
# 安装依赖
npm install

# 执行测试
node test-nginxaas.js
```
