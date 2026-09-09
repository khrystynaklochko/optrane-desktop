# OPTRANE Command v0.5.0

Native Tauri control plane for governed, agentic production operations.

## Security model

OPTRANE Command has one network boundary:

```text
OPTRANE Command
      |
      | OPTRANE user session
      v
OPTRANE Lovable website/API
      |
      +-- human identity/session broker
      +-- production data + private screenplay storage
      +-- governed agent broker
      +-- Google Agent Runtime / ADK / Gemini
      +-- official mcp-clickhouse
      +-- ClickHouse Cloud
      |
      v
normalized result/evidence
```

The desktop does **not** use an identity-provider SDK and does **not** call the governance provider, Google Cloud, ClickHouse or MCP directly.

Production gateway:

```text
https://film-sparkle-layer.lovable.app/api/public/itrain-api
```

The `itrain-api` path is retained only as the deployed compatibility namespace. Product identity is OPTRANE.

## Website registration and desktop pairing

The desktop has no production password form.

```text
OPTRANE Command
  -> POST /desktop-auth/start
  -> browser /desktop/verify
  -> /auth register or login
  -> email verified
  -> website approves pairing
  -> optrane://auth/callback?request_id=...
  -> POST /desktop-auth/exchange with device verifier
  -> OPTRANE user session stored in OS credentials
```

The deep link carries only a request ID. The verifier stays on the initiating device. Access/refresh credentials are returned only by the OPTRANE gateway exchange, exactly once. Refresh/logout also go through OPTRANE (`/auth/refresh`, `/auth/logout`).

## Governed agents

The desktop sees a normalized governed identity only:

- local agent identity,
- passport ID/version,
- trust status/score,
- declared capabilities,
- requested tools and data classes,
- execution budget,
- self-improvement budget,
- normalized run/evidence status.

Provider-native peer endpoints, credentials, policy payloads, signatures, nonces and webhook internals remain backend-only.

## Bounded Gemini self-improvement

Every governed agent can optionally use this exact rule, shown in the registration/detail screens and supplied to Gemini:

> May improve reasoning strategy, prompts, retrieval order, tool ordering, error recovery and confidence thresholds. It may not add tools, expand permissions or data access, change model or executable code, modify governance policy, or increase any budget. Improvements are candidates only and require human approval before promotion.

Defaults:

```text
Improvement budget       $0.25 / iteration
Daily improvement cap    $2.00
Iterations per run       2
Iterations per day       10
```

Server-side safeguards:

1. deterministic budget/iteration ledger is checked before Gemini runs;
2. Google Agent Runtime receives the exact allowed/forbidden rule and remaining cap;
3. any tool call during self-improvement causes the candidate to be rejected;
4. output must be one allow-listed candidate type;
5. the concrete candidate is privately authorized by the governance layer;
6. the candidate is stored but not applied;
7. a producer must approve it;
8. approval creates a new immutable strategy version only.

Promotion cannot change tools, permissions, data classes, model, executable code, policy, secrets or any budget.

## Production intelligence flow

```text
Upload screenplay revision
  -> OPTRANE Lovable gateway
  -> structured revision analysis
  -> ClickHouse fact mirror
  -> Google Agent Runtime / Google ADK / Gemini
  -> official mcp-clickhouse run_query
  -> verified production evidence
  -> deterministic blast radius/readiness
  -> recovery plans
  -> human approval
  -> deterministic mutation + audit
```

## Desktop screens

- Website verification / pairing
- Production Control Room
- New Production
- Script Revision
- Change Review
- Impact Analysis + verified runtime proof
- Recovery Planning
- Dependency Graph
- Agent Fleet
- Register Governed Agent
- Agent Passport / Self-Improvement
- Runs / authorization / normalized evidence
- Audit
- Settings / integration health

## Project structure

```text
src/                              Tauri/React product UI
src-tauri/                        native shell / secure credential commands
backend/lovable/                  OPTRANE Lovable gateway reference
cloud-agent/                      Google ADK Agent Runtime package
clickhouse-mcp/                   official mcp-clickhouse Cloud Run wrapper
docs/itrain-api.md                public desktop contract
```

Private governance provider peer contracts are maintained outside this repository and are not imported by the desktop bundle.

## Desktop configuration

```bash
cp .env.example .env
```

Production defaults are already encoded. Optional overrides:

```env
VITE_OPTRANE_ENV=production
VITE_OPTRANE_WEB_BASE=https://film-sparkle-layer.lovable.app
VITE_OPTRANE_API_PREFIX=/api/public/itrain-api
VITE_OPTRANE_DESKTOP_CALLBACK=optrane://auth/callback
```

No identity-provider key, governance credential, Google credential, ClickHouse password or MCP token belongs in the desktop environment.

## Run

```bash
npm install
npm run dev
```

Native Tauri:

```bash
npm run desktop
```

Package:

```bash
npm run desktop:build
```

## Lovable server secrets

See `backend/lovable/.env.example`. Private values include Google service-account material, ClickHouse writer credentials, MCP bearer token, governance peer client credentials, Ed25519 key pair and webhook secret.

Manual private peer lifecycle is performed through `optrane-governance-admin`, never Tauri. See `BACKEND_CONTRACT.md` and `GOVERNANCE_BOUNDARY.md`.

## Verification

```bash
node scripts/verify_security_boundary.mjs
node scripts/verify_lovable_contract.mjs
```

The first is a static source check ensuring no provider-native governance route/URL/credential or identity-provider SDK leaks into `src/`. The second probes the deployed Lovable public route surface when network access is available.

## Prebuilt recording workflow (v0.5.2)

The verified recording account is:

```text
khrystynaklochko@gmail.com
```

When that account completes website verification, OPTRANE Command opens a dedicated **Recording Workflow** screen once per app session. No password is embedded in the desktop source.

The workflow provides one-click, recording-safe staging:

1. Prepare the NIGHTFALL v7 baseline at 94% readiness.
2. Run strict Google Agent Runtime / Gemini / ClickHouse MCP preflight.
3. Provision the governed Director, Breakdown, Revision, Impact and Recovery fleet.
4. Stage NIGHTFALL v8 with the four Scene 42 material changes.
5. Start the real cloud analysis and keep the ADK + `run_query` event timeline visible.
6. Open the Impact Agent's bounded self-improvement policy and budget caps.
7. Finish on recovery/audit after approving Plan B.

Server routes used only for this allow-listed test user:

```text
POST /api/public/itrain-api/demo/prepare-recording
POST /api/public/itrain-api/demo/load-revision
```

They require both `OPTRANE_DEMO_MODE=true` and the authenticated email to be present in `OPTRANE_RECORDING_TEST_EMAILS`.
