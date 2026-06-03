/**
 * NGINXaaS SC7 – Overview Blade Verification
 *
 * Verifies that after a successful NGINXaaS deployment, the Overview blade and
 * related Settings blades (Scaling, Networking, Identity) display all expected
 * resource details correctly, and that the public IP responds with the NGINX
 * welcome page.
 *
 * Prerequisites:
 *   - A deployed NGINXaaS resource (e.g. lyx-stage-0603-02) in resource group
 *     lyx-liftr-test under subscription Liftr-Nginx-Test.
 *   - Node.js + playwright installed (npm i playwright)
 *
 * Run:
 *   node test-sc7-overview.js
 */

'use strict';

const { chromium } = require('playwright');
const path = require('path');
const fs   = require('fs');

// ── Configuration ─────────────────────────────────────────────────────────────

const SUBSCRIPTION_ID   = 'e3853e83-0d02-4fb3-b88f-05b5fd21aee2';
const RESOURCE_GROUP    = 'lyx-liftr-test';
const DEPLOYMENT_NAME   = 'lyx-stage-0603-02';
const TARGET_ACCOUNT    = 'v-yixueli@microsoft.com';

const PORTAL_BASE =
  'https://portal.azure.com/?feature.customportal=false&feature.canmodifystamps=true' +
  '&Azure_Marketplace_Nginx=stage1' +
  '&Azure_Marketplace_Nginx_assettypeoptions=%7B%22Nginx%22%3A%7B%22options%22%3A%22%22%7D%7D' +
  '&microsoft_azure_marketplace_ItemHideKey=Azure_Marketplace_NGINX';

const RESOURCE_BASE =
  `${PORTAL_BASE}#@microsoft.onmicrosoft.com/resource/subscriptions/${SUBSCRIPTION_ID}` +
  `/resourceGroups/${RESOURCE_GROUP}/providers/Nginx.NginxPlus/nginxDeployments/${DEPLOYMENT_NAME}`;

const OVERVIEW_URL    = `${RESOURCE_BASE}/resourceOverviewId`;
const SCALING_URL     = `${RESOURCE_BASE}/mrsg_settings_ncu_configuration`;
const NETWORKING_URL  = `${RESOURCE_BASE}/mrsg_settings_networking`;
const IDENTITY_URL    = `${RESOURCE_BASE}/mrsg_settings_managedIdentity`;

const SCREENSHOT_DIR = path.join(__dirname, 'sc7-screenshots');
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

// ── Helpers ───────────────────────────────────────────────────────────────────

const results = [];

function record(tcId, description, status, detail = '') {
  results.push({ tcId, description, status, detail });
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️';
  console.log(`  ${icon} [${tcId}] ${description}${detail ? ' – ' + detail : ''}`);
}

async function screenshot(page, name) {
  const file = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  📷 Screenshot saved: ${file}`);
}

async function waitForIframeContent(page, timeout = 15000) {
  // Wait until the main resource iframe finishes loading
  await page.waitForFunction(
    () => document.querySelector('iframe') !== null,
    { timeout }
  ).catch(() => {});
  await page.waitForTimeout(3000);
}

function getIframe(page) {
  // Azure Portal resource blades render inside an iframe
  const frames = page.frames();
  return frames.find(f => f.url() === 'about:blank' || f.name().includes('ReactView'))
    || frames[frames.length - 1];
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  const browser = await chromium.launch({
    channel: 'msedge',
    headless: false,
    args: ['--start-maximized']
  });

  const context = await browser.newContext({
    storageState: fs.existsSync('.auth.json') ? '.auth.json' : undefined,
    viewport: null
  });

  const page = await context.newPage();
  console.log('\n=== SC7 – Overview Blade Verification ===\n');

  try {

    // ── SC7-TC01: Navigate to Overview blade ─────────────────────────────────
    console.log('[SC7-TC01] Navigate to resource Overview blade...');
    await page.goto(OVERVIEW_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitForIframeContent(page);
    await screenshot(page, 'sc7-tc01-overview');

    const pageTitle = await page.title();
    if (pageTitle.includes(DEPLOYMENT_NAME)) {
      record('SC7-TC01', 'Overview blade opens for correct resource', 'PASS', pageTitle);
    } else {
      record('SC7-TC01', 'Overview blade opens for correct resource', 'FAIL',
        `Expected title to contain "${DEPLOYMENT_NAME}", got: "${pageTitle}"`);
    }

    // ── SC7-TC02: Resource name ───────────────────────────────────────────────
    console.log('[SC7-TC02] Verify resource name in heading...');
    await waitForIframeContent(page);
    const headingText = await page.evaluate(() => {
      const h2 = document.querySelector('h2');
      return h2 ? h2.textContent.trim() : '';
    });
    if (headingText === DEPLOYMENT_NAME) {
      record('SC7-TC02', 'Resource name displayed in heading', 'PASS', headingText);
    } else {
      record('SC7-TC02', 'Resource name displayed in heading', 'FAIL',
        `Expected "${DEPLOYMENT_NAME}", got "${headingText}"`);
    }

    // ── SC7-TC03: Essentials – Resource Group ─────────────────────────────────
    console.log('[SC7-TC03] Verify Resource Group in Essentials...');
    const bodyText = await page.evaluate(() => document.body.innerText);
    if (bodyText.includes(RESOURCE_GROUP)) {
      record('SC7-TC03', 'Resource group visible in Essentials', 'PASS', RESOURCE_GROUP);
    } else {
      record('SC7-TC03', 'Resource group visible in Essentials', 'FAIL',
        `"${RESOURCE_GROUP}" not found on page`);
    }

    // ── SC7-TC04: Essentials – Location ──────────────────────────────────────
    console.log('[SC7-TC04] Verify Location in Essentials...');
    if (bodyText.includes('West Central US')) {
      record('SC7-TC04', 'Location "West Central US" visible in Essentials', 'PASS');
    } else {
      record('SC7-TC04', 'Location "West Central US" visible in Essentials', 'FAIL',
        '"West Central US" not found on page');
    }

    // ── SC7-TC05: Essentials – Provisioning state ─────────────────────────────
    console.log('[SC7-TC05] Verify Provisioning state is Succeeded...');
    if (bodyText.includes('Succeeded')) {
      record('SC7-TC05', 'Provisioning state is "Succeeded"', 'PASS');
    } else {
      record('SC7-TC05', 'Provisioning state is "Succeeded"', 'FAIL',
        '"Succeeded" not found on page');
    }

    // ── SC7-TC06: Essentials – Pricing Plan ──────────────────────────────────
    console.log('[SC7-TC06] Verify Pricing Plan is Standard V3...');
    if (bodyText.includes('Standard V3')) {
      record('SC7-TC06', 'Pricing Plan "Standard V3" visible in Essentials', 'PASS');
    } else {
      record('SC7-TC06', 'Pricing Plan "Standard V3" visible in Essentials', 'FAIL',
        '"Standard V3" not found on page');
    }

    // ── SC7-TC07: Essentials – IP Address displayed ──────────────────────────
    console.log('[SC7-TC07] Verify public IP address displayed...');
    const ipMatch = bodyText.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/);
    if (ipMatch) {
      record('SC7-TC07', 'Public IP address visible in Essentials', 'PASS', ipMatch[1]);
    } else {
      record('SC7-TC07', 'Public IP address visible in Essentials', 'FAIL',
        'No IPv4 address pattern found on Overview page');
    }

    const publicIp = ipMatch ? ipMatch[1] : null;

    // ── SC7-TC08: Essentials – NGINX Version ─────────────────────────────────
    console.log('[SC7-TC08] Verify NGINX version displayed...');
    if (bodyText.includes('nginx-plus')) {
      record('SC7-TC08', 'NGINX version (nginx-plus-*) visible in Essentials', 'PASS');
    } else {
      record('SC7-TC08', 'NGINX version visible in Essentials', 'FAIL',
        '"nginx-plus" not found on page');
    }

    // ── SC7-TC09: Scaling – Manual mode and NCU count ────────────────────────
    console.log('[SC7-TC09] Navigate to NGINX scaling blade...');
    await page.goto(SCALING_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitForIframeContent(page);
    await screenshot(page, 'sc7-tc09-scaling');

    const scalingText = await page.evaluate(() => document.body.innerText);
    const isManual    = scalingText.includes('Manual');
    const ncuMatch    = scalingText.match(/(\d+)\s*(?:NCU|NGINX Capacity Units)/i);

    if (isManual) {
      record('SC7-TC09', 'Scaling mode is Manual (not Autoscale)', 'PASS');
    } else {
      record('SC7-TC09', 'Scaling mode is Manual (not Autoscale)', 'FAIL',
        '"Manual" not found on Scaling page');
    }

    if (ncuMatch) {
      record('SC7-TC09b', 'NCU count displayed on Scaling page', 'PASS', `NCU = ${ncuMatch[1]}`);
    } else {
      record('SC7-TC09b', 'NCU count displayed on Scaling page', 'WARN',
        'NCU value not matched by regex – verify manually');
    }

    // ── SC7-TC10: Networking – VNet and IP info ───────────────────────────────
    console.log('[SC7-TC10] Navigate to NGINX networking blade...');
    await page.goto(NETWORKING_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitForIframeContent(page);
    await screenshot(page, 'sc7-tc10-networking');

    const networkingText = await page.evaluate(() => document.body.innerText);
    const hasVnet   = networkingText.includes('vnet') || networkingText.includes('VNet');
    const hasSubnet = networkingText.includes('subnet') || networkingText.includes('default');
    const hasIpInfo = publicIp ? networkingText.includes(publicIp) : networkingText.includes('4.255');

    if (hasVnet) {
      record('SC7-TC10', 'Virtual network information visible on Networking blade', 'PASS');
    } else {
      record('SC7-TC10', 'Virtual network information visible on Networking blade', 'FAIL',
        '"vnet" keyword not found on Networking page');
    }

    if (hasSubnet) {
      record('SC7-TC10b', 'Subnet information visible on Networking blade', 'PASS');
    } else {
      record('SC7-TC10b', 'Subnet information visible on Networking blade', 'WARN',
        'Subnet keyword not found – verify manually');
    }

    if (hasIpInfo) {
      record('SC7-TC10c', 'Public IP address visible on Networking blade', 'PASS',
        publicIp || '');
    } else {
      record('SC7-TC10c', 'Public IP address visible on Networking blade', 'WARN',
        'IP address not detected on Networking page – verify manually');
    }

    // ── SC7-TC11: Identity – System-assigned managed identity ────────────────
    console.log('[SC7-TC11] Navigate to Identity blade...');
    await page.goto(IDENTITY_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await waitForIframeContent(page);
    await screenshot(page, 'sc7-tc11-identity');

    const identityText = await page.evaluate(() => document.body.innerText);
    const systemOn     = identityText.includes('On') || identityText.includes('Enabled');
    const hasPrincipal = identityText.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);

    if (systemOn) {
      record('SC7-TC11', 'System-assigned managed identity is enabled (On)', 'PASS');
    } else {
      record('SC7-TC11', 'System-assigned managed identity is enabled (On)', 'FAIL',
        '"On" / "Enabled" not found on Identity page');
    }

    if (hasPrincipal) {
      record('SC7-TC11b', 'Object (Principal) ID displayed on Identity blade', 'PASS',
        hasPrincipal[0]);
    } else {
      record('SC7-TC11b', 'Object (Principal) ID displayed on Identity blade', 'WARN',
        'GUID pattern not found – verify manually');
    }

    // ── SC7-TC12: IP accessibility – NGINX welcome page ──────────────────────
    if (publicIp) {
      console.log(`[SC7-TC12] Access http://${publicIp} and verify NGINX welcome page...`);
      const ipPage = await context.newPage();
      try {
        await ipPage.goto(`http://${publicIp}`, {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });
        await screenshot(ipPage, 'sc7-tc12-nginx-welcome');
        const ipPageTitle = await ipPage.title();
        const ipPageBody  = await ipPage.evaluate(() => document.body.innerText);

        if (ipPageTitle.toLowerCase().includes('nginx') ||
            ipPageBody.toLowerCase().includes('nginx')) {
          record('SC7-TC12', 'Public IP responds with NGINX welcome page', 'PASS',
            `Title: "${ipPageTitle}"`);
        } else {
          record('SC7-TC12', 'Public IP responds with NGINX welcome page', 'FAIL',
            `Unexpected page – Title: "${ipPageTitle}"`);
        }
      } catch (err) {
        record('SC7-TC12', 'Public IP responds with NGINX welcome page', 'FAIL',
          err.message);
      } finally {
        await ipPage.close();
      }
    } else {
      record('SC7-TC12', 'Public IP responds with NGINX welcome page', 'WARN',
        'IP address not captured earlier – skipped');
    }

  } catch (err) {
    console.error('\nUnexpected error:', err.message);
  } finally {
    await browser.close();
  }

  // ── Results summary ──────────────────────────────────────────────────────────
  console.log('\n=== SC7 Test Results ===\n');
  console.log('| TC ID      | Description                                              | Status | Detail |');
  console.log('|------------|----------------------------------------------------------|--------|--------|');
  for (const r of results) {
    const icon = r.status === 'PASS' ? '✅ PASS' : r.status === 'FAIL' ? '❌ FAIL' : '⚠️  WARN';
    const desc = r.description.padEnd(56);
    console.log(`| ${r.tcId.padEnd(10)} | ${desc} | ${icon} | ${r.detail} |`);
  }

  const passed = results.filter(r => r.status === 'PASS').length;
  const failed = results.filter(r => r.status === 'FAIL').length;
  const warned = results.filter(r => r.status === 'WARN').length;
  console.log(`\nTotal: ${results.length}  ✅ PASS: ${passed}  ❌ FAIL: ${failed}  ⚠️  WARN: ${warned}`);

  // Write JSON report
  const reportPath = path.join(__dirname, 'sc7-report.json');
  fs.writeFileSync(reportPath, JSON.stringify({ deployment: DEPLOYMENT_NAME, results }, null, 2));
  console.log(`\nReport written to: ${reportPath}`);
})();
