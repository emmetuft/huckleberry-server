# Provisioning Assumptions & Open Questions

Assumptions made during the per-instance OAuth client credential design. Each needs confirmation before prod deployment. Answers here feed back into DESIGN.md and implementation decisions.

---

## Confirmed Assumptions

| # | Assumption | Basis |
|---|-----------|-------|
| A1 | **Primary flow:** Huckleberry spins up the Domo instances it registers on — we control Gatekeeper config | Self-provisioned instances |
| A2 | **Tertiary flow (Connect to Domo):** Huckleberry integrates with an *existing* instance it does NOT control | User brings their own instance; assume open-mode DCR works (default) |
| A3 | Public client (PKCE-only, no `client_secret`) is secure enough for user-delegated flows | Server-side attacker who can steal `code_verifier` can also steal a secret |
| A4 | Aurora disk-level KMS encryption covers at-rest protection for `registrationAccessToken` | Same treatment as refresh tokens today |
| A5 | Signup fails hard if DCR/Gatekeeper is unreachable | No partial states; instance is unusable anyway |
| A6 | User status explicitly tracks signup path: `pending_provision` → `pending_link` → `active` | SPA routes on a single `status` field without inspecting link row data |

---

## Open Questions (need answers before prod)

### Q1: DCR on instances we don't control (tertiary "Connect to Domo" flow)
**Context:** In the tertiary flow, the user links to an *existing* Domo instance that huckleberry didn't provision.
**Decision:** Assume open-mode DCR works (IAT mode is `false` by default on all Gatekeeper instances — no evidence any have it enabled). Attempt `POST {issuerUrl}/oauth2/register` without auth. If it works, seamless. Build more complex code paths (IAT fallback, manual admin path) only if/when we encounter instances that require it.
**Rationale:** No current instances have IAT enabled. Building the fallback now is speculative complexity. The 401/403 response is a clear signal to revisit.

### Q2: DCR idempotency / deduplication
**Context:** Does Gatekeeper deduplicate DCR calls (same `redirect_uri` + `scope` → same `client_id`), or does each POST mint a new client?
**Impact:** If no dedup, a network timeout + retry could orphan a registered client on the Gatekeeper side (client exists but BFF never stored the `client_id`).
**Follow-up:** If no dedup, do we need a cleanup mechanism? Or is the 30-day unused-client auto-expiry sufficient?

### Q3: What does the freemium-provisioning API return?
**Context:** `InstanceProvisioner.provision()` calls Domo's provisioning API to mint a tenant. What metadata comes back?
**Needed:** `issuerUrl`, `customerId`. Does it also return anything useful for DCR (admin credential, bootstrap token, pre-registered client)?
**Impact:** Determines whether DCR is a separate step or can be combined with provisioning.

### Q4: Redirect URI per environment
**Context:** DCR registers `redirect_uris`. In prod, this is `https://<prod-domain>/api/auth/domo/callback`. Do all environments share one BFF domain, or does each env (staging, prod) have its own?
**Impact:** Determines whether we register one redirect URI or multiple per client.

### Q5: Scope evolution
**Context:** DCR registers a fixed `scope` set. If huckleberry needs new scopes later (e.g., `content:write`), do we re-register the client (RFC 7592 PUT) or is scope additive at the authorize-time `scope` param?
**Impact:** Determines whether we need a migration path for scope changes on existing clients.

### Q6: Frontend "Connect to Domo" entry point
**Context:** Tertiary signup flow — user has already signed up + authenticated via magic-link, then connects their Domo instance as a separate step.
**Status:** Confirmed as post-auth flow for users in `pending_link` status.
**Impact:** `issuerUrl` can be auto-filled from provisioning metadata; user doesn't need to type it.

### Q7: IAT mode configuration — architecture check for instance spin-up
**Context:** Gatekeeper's `oauth.server.client-registration.initial-access-token.required` defaults to `false`. No known instances have it enabled. If this changes (admin flips it on for a customer instance), open-mode DCR will start returning 401.
**Action:** When defining instance spin-up infra, confirm IAT mode stays off for huckleberry-provisioned instances. Monitor for 401s on the DCR path as a signal to revisit.
**If triggered:** Build IAT fallback (user provides token from admin console) or manual `client_id` entry. Not needed until then.

---

## Notes

- Gatekeeper auto-expires unused clients after 30 days (`oauth.server.client-registration.unused-client-expiry = P30D`)
- Gatekeeper rate-limits DCR at 10 registrations/hour/IP, 50 clients/tenant quota
- `registration_access_token` is displayed once at registration, stored as BCrypt hash on Gatekeeper side — we must persist it or lose self-management access
