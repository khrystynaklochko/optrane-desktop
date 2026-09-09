# OPTRANE Command public endpoint matrix

The Tauri application has exactly one network service boundary:

```text
<LOVABLE_BASE>/api/public/itrain-api
```

Canonical OPTRANE API gateway:

```text
https://film-sparkle-layer.lovable.app/api/public/itrain-api
```

`GET /health` and the documented desktop-auth bootstrap are public. Every business route uses an OPTRANE user bearer session. The desktop does **not** contain or call provider-native governance endpoints.

## Human account + desktop pairing

| Purpose | Method + path | Caller |
|---|---|---|
| Website registration | `POST /auth/register` | OPTRANE website |
| Website login | `POST /auth/login` | OPTRANE website |
| Refresh desktop session | `POST /auth/refresh` | OPTRANE Command |
| Current account | `GET /auth/me` | Website / desktop |
| Logout | `POST /auth/logout` | Website / desktop |
| Start desktop pairing | `POST /desktop-auth/start` | OPTRANE Command |
| Pairing state | `GET /desktop-auth/:requestId/status?verifier=...` | OPTRANE Command |
| Approve desktop | `POST /desktop-auth/:requestId/approve` | authenticated OPTRANE website |
| One-use session exchange | `POST /desktop-auth/exchange` | OPTRANE Command |

The deep link contains only `request_id`. The high-entropy verifier remains on the initiating device. Access and refresh credentials are returned only by `/desktop-auth/exchange` and stored in the OS credential store.

## Production

| Purpose | Method + path |
|---|---|
| Health | `GET /health` |
| List productions | `GET /productions` |
| Create production | `POST /productions` |
| Summary | `GET /productions/:p/summary` |
| Dependency graph | `GET /productions/:p/graph` |
| Audit | `GET /productions/:p/audit` |
| Evidence | `GET /productions/:p/evidence?limit=200&since=<iso>&kinds=audit,ai,analysis,delta` |
| Upload screenplay | `POST /scripts/upload` multipart |
| Start analysis | `POST /analyses` |
| Analysis detail | `GET /analyses/:id` |
| Analysis events | `GET /analyses/:id/events` SSE |
| Approve recovery | `POST /recovery-plans/:id/approve` |
| Reject recovery | `POST /recovery-plans/:id/reject` |
| Reset demo | `POST /demo/reset` |

## Governed agents — OPTRANE-normalized only

| Purpose | Method + path |
|---|---|
| Integration status | `GET /system/integrations` |
| Governance status | `GET /system/governance/status` |
| List agents | `GET /productions/:p/agents` |
| Register agent | `POST /productions/:p/agents/register` |
| Register default fleet | `POST /productions/:p/agents/register-fleet` |
| Agent detail | `GET /productions/:p/agents/:a` |
| Sync governed identity | `POST /productions/:p/agents/:a/sync` |
| Retry registration | `POST /productions/:p/agents/:a/retry-registration` |
| Revoke agent | `POST /productions/:p/agents/:a/revoke` |
| List runs | `GET /productions/:p/agents/:a/runs` |
| Start run | `POST /productions/:p/agents/:a/runs` |
| Request governed action | `POST /productions/:p/agents/:a/authorize` |
| Read normalized evidence | `GET /productions/:p/agents/:a/evidence` |
| Add user note | `POST /productions/:p/agents/:a/evidence` |
| List improvement candidates | `GET /productions/:p/agents/:a/improvements` |
| Ask Gemini for one candidate | `POST /productions/:p/agents/:a/improvements/propose` |
| Human approve candidate | `POST /productions/:p/agents/:a/improvements/:candidateId/approve` |
| Human reject candidate | `POST /productions/:p/agents/:a/improvements/:candidateId/reject` |

No public desktop route exists for peer claim, peer signing, provider nonce handling, provider credentials, native policy payloads or provider webhooks.

## Backend-only surfaces

These are intentionally outside the desktop contract:

```text
/functions/v1/optrane-governance-admin/*
<provider webhook — backend-only, signature-verified>
```

The private admin function requires `X-OPTRANE-Admin-Key`. The provider webhook is signature-verified and replay-protected. Provider-native peer routes are server-side implementation details and are not published in this repository.

## Recording-only test routes

These routes are authenticated, require `OPTRANE_DEMO_MODE=true`, and reject users not in `OPTRANE_RECORDING_TEST_EMAILS`.

| Purpose | Method + path |
|---|---|
| Prepare NIGHTFALL v7 / 94% baseline | `POST /api/public/itrain-api/demo/prepare-recording` |
| Stage NIGHTFALL v8 / four Scene 42 changes | `POST /api/public/itrain-api/demo/load-revision` |

Default allow-listed test account: `khrystynaklochko@gmail.com`.
