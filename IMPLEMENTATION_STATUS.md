# OPTRANE v0.5.0 implementation status

## Desktop trust boundary

- [x] Website-first account registration/login/email verification.
- [x] High-entropy desktop pairing verifier.
- [x] Deep link contains request ID only.
- [x] One-use `/desktop-auth/exchange`.
- [x] OS credential-store session persistence.
- [x] Session refresh/logout only through OPTRANE gateway.
- [x] No Supabase SDK or publishable key in Tauri source.
- [x] No provider-native governance route/URL/credential in Tauri source.
- [x] No direct Google/ClickHouse/MCP calls from Tauri.

## Private peer governance

- [x] Backend-only peer claim.
- [x] Ed25519 challenge proof.
- [x] Signed canonical peer requests.
- [x] timestamp freshness checks.
- [x] nonce replay protection.
- [x] signature-checked webhook + event replay protection.
- [x] private manual `optrane-governance-admin` lifecycle.
- [x] provider-side reference API/migration maintained outside the public repository.

## Governed agents

- [x] server-side identity/passport provisioning.
- [x] capabilities, tools, data grants, policies and budget binding.
- [x] default governed production fleet.
- [x] run creation and action authorization.
- [x] normalized evidence only to Tauri.
- [x] desktop cannot submit provider evidence; POST evidence is user-note only.
- [x] revoke/sync/retry via OPTRANE only.

## Bounded Gemini self-improvement

- [x] rule displayed on registration and agent-detail screens.
- [x] exact rule supplied to Google Agent Runtime.
- [x] allowed candidate types are allow-listed.
- [x] authority escalation, tools, permissions, data, model, code, policy, secrets and budget increases forbidden.
- [x] per-iteration, daily and iteration-count caps.
- [x] deterministic server ledger.
- [x] any tool call during self-improvement is rejected.
- [x] concrete candidate privately authorized by governance provider.
- [x] candidate-only output; no automatic self-modification.
- [x] human approval required.
- [x] approval creates immutable strategy version only.

## Cloud/partner path

- [x] Google ADK Agent Runtime package.
- [x] Gemini runtime.
- [x] official mcp-clickhouse toolset filtered to `run_query`.
- [x] read-only MCP server configuration.
- [x] deterministic ClickHouse fact mirror.
- [x] strict runtime verification of MCP function call/response.
- [x] integration-health UI.

## Deployment boundary

Source is implemented. Real deployment still requires the user's Lovable/Supabase, Google Cloud, ClickHouse and governance-provider secrets/resources.

## v0.5.2 recording workflow

- Prebuilt recording account: `khrystynaklochko@gmail.com`
- Recording Workflow screen added to the desktop for that verified account.
- First-use test account bootstrap can prepare NIGHTFALL v7 at 94% automatically.
- Recording-only backend routes are email allow-listed and require demo mode.
- One-click stage for NIGHTFALL v8 with four material changes.
- One-click strict integration preflight.
- One-click governed default fleet provisioning.
- Live Google ADK / Gemini / official ClickHouse MCP analysis remains real.
- One-click navigation to Impact Agent self-improvement policy and audit/recovery screens.
- No password is embedded in source.
