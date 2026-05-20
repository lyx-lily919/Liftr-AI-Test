# NGINXaaS for Azure Portal Test Plan

## 3.1 Deployment Wizard

---

### SC1 – Service discovery

Search for `NGINXaaS` in the Azure Portal and select **+ Create**. Verify that the NGINXaaS Create wizard opens at the **Basics** tab.

---

### SC2 – Basics field validation

Enter combinations of valid and invalid input on the Basics tab:

- Leave required fields (Name, Resource group, Subscription) empty; provide names with invalid characters or duplicate names.
- Provide an invalid email address or omit email.
- Select unsupported regions or pricing plans.
- Toggle between **Manual** and **Autoscale** scaling modes and choose invalid NCUs (e.g., 0 or non‑multiple of 10) under Manual.

**Expectation:** The portal displays relevant validation errors; it shows available pricing and upgrade options per plan; autoscaling is disabled for the Developer plan.

---

### SC3 – Networking configuration

On the Networking tab:

- Configure a **new** virtual network and confirm that the wizard creates a /27 subnet delegated to `NGINX.NGINXPLUS/nginxDeployments`.
- Select an **existing** VNet/subnet that is not delegated or too small (< /27), and verify the portal rejects the choice with an error.
- Choose a **public** IP and ensure there is an option to create a new IP or use an existing one; select a **private** IP and verify requirement for a static IP from the subnet range.
- Test inbound port rules: confirm that the option to choose ports (80, 443) is only available when creating a new VNet; existing NSGs require manual rule edits.
- Toggle **Apply default NGINX configuration** and note that this determines whether a default splash page appears after deployment.

---

### SC4 – Tags and Review

Add multiple tags (including duplicates and special characters) on the Tags tab; verify editing and deletion of tags. Proceed to **Review + Create** and confirm that the wizard surfaces any outstanding validation errors and that all selections are summarized correctly.

---

### SC5 – Deployment creation

Complete the wizard with valid inputs and submit. Monitor the deployment progress until completion. Confirm the new NGINXaaS resource appears in the resource group; the Overview page displays deployment details (name, region, IP, pricing plan, scaling settings). Verify that the IP responds with the NGINX welcome page if default config was applied, or shows no page if default was not applied.

---

### SC6 – Permission and pre‑condition failures

Attempt to create a deployment without required permissions (e.g., using a user with Reader role) or with invalid network configuration (non‑delegated or undersized subnet). Expect the portal to refuse creation and show actionable error messages referencing necessary roles or delegation.

---

### SC7 – Overview blade verification

After successful deployment, navigate to the **Overview** blade and verify that all key details are displayed correctly:

- Resource name, resource group, subscription, location/region
- Pricing plan (Standard V3 or Developer)
- Scaling configuration (Manual/Autoscale, current NCUs)
- IP address (public or private)
- Virtual network and subnet information
- Managed identity status (system-assigned and/or user-assigned)
- Provisioning state and deployment status
- Tags (if configured)

Test that the IP address is functional by accessing it via browser and verifying the NGINX welcome page (if default configuration was applied) or confirming expected application response.
