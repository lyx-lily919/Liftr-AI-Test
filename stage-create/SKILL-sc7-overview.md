# NGINXaaS SC7 – Overview Blade Verification Skill

## Overview

This Skill covers the **post-deployment verification** of an NGINXaaS for Azure resource.
After a successful deployment, the tester navigates to the resource's Overview blade (and
related Settings sub-blades) to confirm that all key details are displayed correctly, and
that the deployed instance is accessible from the internet.

Test script: `test-sc7-overview.js`
Screenshot directory: `sc7-screenshots/`

---

## Prerequisites

- An NGINXaaS resource has been successfully deployed (provisioning state: **Succeeded**).
- The resource is accessible in the Azure Portal under the target subscription and resource group.
- The deployment was configured with **"Apply default NGINX configuration"** enabled, so the
  public IP should serve the NGINXaaS welcome page.

---

## Test Environment

| Parameter        | Value                          |
|------------------|--------------------------------|
| Account          | `v-yixueli@microsoft.com`      |
| Subscription     | `Liftr-Nginx-Test`             |
| Resource group   | `lyx-liftr-test`               |
| Deployment name  | `lyx-stage-0603-02`            |
| Region           | `West Central US`              |
| Pricing plan     | `Standard V3`                  |
| Scaling mode     | `Manual`, 20 NCUs              |
| IP type          | Public                         |

---

## Blades to Verify

| Blade            | Portal URL fragment                          |
|------------------|----------------------------------------------|
| Overview         | `/resourceOverviewId`                        |
| NGINX scaling    | `/mrsg_settings_ncu_configuration`           |
| NGINX networking | `/mrsg_settings_networking`                  |
| Identity         | `/mrsg_settings_managedIdentity`             |

---

## Test Cases

### SC7-TC01 – Overview blade opens for the correct resource

Navigate to the resource's Overview blade.
Verify the browser page title contains the deployment name (`lyx-stage-0603-02`).

**Pass condition:** Page title includes the resource name.

---

### SC7-TC02 – Resource name in heading

On the Overview blade, verify the `<h2>` heading displays exactly the resource name.

**Pass condition:** Heading text equals the deployment name.

---

### SC7-TC03 – Resource group in Essentials

In the Essentials section, verify the **Resource group** field shows `lyx-liftr-test`
with a clickable link.

**Pass condition:** Resource group name is visible on the page.

---

### SC7-TC04 – Location in Essentials

In the Essentials section, verify the **Location** field shows `West Central US`.

**Pass condition:** "West Central US" is present in the Essentials area.

---

### SC7-TC05 – Provisioning state is Succeeded

In the Essentials section, verify the **Status** field shows `Succeeded`.

**Pass condition:** "Succeeded" is visible on the page.

---

### SC7-TC06 – Pricing plan in Essentials

In the Essentials section, verify the **Pricing Plan** field shows `Standard V3`.

**Pass condition:** "Standard V3" is visible on the page.

---

### SC7-TC07 – Public IP address in Essentials

In the Essentials section, verify the **IP address** field shows a valid public IPv4
address with a clickable link that navigates to the Networking blade.

**Pass condition:** An IPv4 address pattern is found on the Overview page.

---

### SC7-TC08 – NGINX version in Essentials

In the Essentials section, verify the **NGINX version** field shows the installed
NGINX Plus build (e.g., `1.29.3 (nginx-plus-r36-p5)`) with a link to the changelog.

**Pass condition:** "nginx-plus" keyword is visible on the page.

---

### SC7-TC09 – Scaling mode and NCU count (NGINX scaling blade)

Navigate to **Settings > NGINX scaling**.
Verify:
- Scaling mode is **Manual** (not Autoscale).
- The current **NGINX Capacity Units (NCU)** value is displayed (expected: 20).

**Pass condition:** "Manual" is visible; an NCU integer value is displayed.

---

### SC7-TC10 – Virtual network and IP info (NGINX networking blade)

Navigate to **Settings > NGINX networking**.
Verify:
- The **Virtual network** and **subnet** linked to the deployment are displayed.
- The **frontend public IP address** and its name are listed.

**Pass condition:** "vnet" keyword and subnet name are visible; public IP is listed.

---

### SC7-TC11 – System-assigned managed identity (Identity blade)

Navigate to **Settings > Identity**.
Verify:
- The **System-assigned** tab shows status **On**.
- An **Object (Principal) ID** (GUID) is displayed.

**Pass condition:** "On" or "Enabled" is visible; a GUID is present on the Identity page.

---

### SC7-TC12 – Public IP responds with NGINX welcome page

Open `http://<public-ip>` in the browser.
Verify the response is the NGINXaaS for Azure welcome page
("Welcome to NGINX as a Service for Azure!").

**Pass condition:** Page title or body contains "nginx" (case-insensitive).

---

## Execution Notes

### Navigating to blades

Each blade is accessed by constructing the full portal deep-link URL:

```
https://portal.azure.com/...#@<tenant>/resource/subscriptions/<sub>/resourceGroups/<rg>/
providers/Nginx.NginxPlus/nginxDeployments/<name>/<blade-fragment>
```

### Iframe rendering

Azure Portal resource blades render inside iframes. When using
`mcp_microsoft_pla_browser_run_code_unsafe`, access the blade content through the
correct iframe frame context. Wait at least 3 seconds after navigation before
reading page content to allow the React view to render.

### "See more" in Essentials

The Essentials section initially hides some fields (e.g., Billing Term). Click the
**"See more"** button to expand all fields before asserting their presence.

### IP accessibility test

The IP test should be performed in a separate page/tab to avoid navigating away from
the portal session. Close the IP tab after capturing the screenshot.

---

## Expected Outcome (based on actual execution 2026-06-03)

| TC ID      | Description                                              | Status |
|------------|----------------------------------------------------------|--------|
| SC7-TC01   | Overview blade opens for correct resource                | PASS   |
| SC7-TC02   | Resource name displayed in heading                       | PASS   |
| SC7-TC03   | Resource group visible in Essentials                     | PASS   |
| SC7-TC04   | Location "West Central US" visible in Essentials         | PASS   |
| SC7-TC05   | Provisioning state is "Succeeded"                        | PASS   |
| SC7-TC06   | Pricing Plan "Standard V3" visible in Essentials         | PASS   |
| SC7-TC07   | Public IP address (4.255.136.188) visible in Essentials  | PASS   |
| SC7-TC08   | NGINX version (nginx-plus-r36-p5) visible in Essentials  | PASS   |
| SC7-TC09   | Scaling mode is Manual                                   | PASS   |
| SC7-TC09b  | NCU count = 20 displayed on Scaling page                 | PASS   |
| SC7-TC10   | Virtual network information visible on Networking blade  | PASS   |
| SC7-TC10b  | Subnet information visible on Networking blade           | PASS   |
| SC7-TC10c  | Public IP visible on Networking blade                    | PASS   |
| SC7-TC11   | System-assigned managed identity is On                   | PASS   |
| SC7-TC11b  | Object (Principal) ID displayed on Identity blade        | PASS   |
| SC7-TC12   | Public IP responds with NGINX welcome page               | PASS   |

All 16 checks passed. The Overview blade and related blades correctly display all
required deployment details, and the instance is accessible from the internet.

---

## Navigation: Finding the Deployment via Resource Group

Use this flow when you need to locate the NGINXaaS resource by browsing through
the Azure Portal resource group instead of navigating directly by URL.

### Step 1 – Open the Azure Portal

Navigate to the Azure Portal with the stage feature flags:

```
https://portal.azure.com/?feature.customportal=false&feature.canmodifystamps=true
  &Azure_Marketplace_Nginx=stage1
  &Azure_Marketplace_Nginx_assettypeoptions={"Nginx":{"options":""}}
  &microsoft_azure_marketplace_ItemHideKey=Azure_Marketplace_NGINX
  #home
```

Sign in as `v-yixueli@microsoft.com` if prompted with an account picker.

### Step 2 – Search for "Resource groups"

1. Click the **search box** in the top navigation bar.
2. Type `resource groups`.
3. Click the **Resource groups** option in the search results dropdown.

### Step 3 – Filter for the target resource group

On the Resource groups list page:

1. Click the **Search box** (filter) in the resource group list.
2. Type `lyx-liftr-test` to narrow the results to one entry.
3. Click the link **lyx-liftr-test** in the filtered results.

### Step 4 – Locate the NGINXaaS resource

On the `lyx-liftr-test` resource group Overview page:

1. In the **Resources** tab, use the **"Filter for any field…"** search box.
2. Type the deployment name (e.g., `lyx-stage-0603-02`) to filter the resource list.
3. If the resource is not visible on the first page, scroll down or use the filter to
   narrow by **Type = NGINXaaS**.
4. Click the link with the deployment name (Type: **NGINXaaS**) to enter the resource.

> **Note:** The resource group may contain many resources (29+ in this environment).
> Always use the filter box to avoid scrolling through multiple pages.

### Step 5 – Confirm you are on the correct resource

After clicking the deployment link, the portal navigates to:

```
.../providers/Nginx.NginxPlus/nginxDeployments/<deployment-name>/resourceOverviewId
```

Verify:
- The page title is `<deployment-name> - Microsoft Azure`.
- The `<h2>` heading shows the deployment name.
- The Essentials section is visible with Resource group, Location, and Status fields.

Once confirmed, proceed with the SC7 test cases starting from **SC7-TC01**.
