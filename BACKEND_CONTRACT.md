# OPTRANE Command backend contract

## One boundary

```text
OPTRANE Command -> OPTRANE Lovable website/API -> downstream services
```

The Tauri application does not call the identity provider, governance provider, Google Cloud, ClickHouse or MCP directly. After website verification it holds only an OPTRANE user session and calls:

```text
<LOVABLE_BASE>/api/public/itrain-api
```

The compatibility namespace remains `itrain-api` until the deployed Lovable route is migrated; product identity is OPTRANE.

## Login and registration

1. Desktop calls `POST /desktop-auth/start`.
2. Desktop opens `<BASE>/desktop/verify?request_id=...`.
3. The OPTRANE website offers account registration and login through `/auth/register` and `/auth/login`.
4. Email verification happens on the website.
5. Authenticated website calls `POST /desktop-auth/:requestId/approve`.
6. Browser returns through `optrane://auth/callback?request_id=...`.
7. Desktop calls `POST /desktop-auth/exchange` with its request ID + device-held verifier.
8. OPTRANE returns the user access/refresh session exactly once.
9. Tauri stores the session in the OS credential store.
10. Session refresh and logout go only through `/auth/refresh` and `/auth/logout`.

No access token, refresh token, governance token, provider endpoint or service credential appears in the deep-link URL.

## Agent boundary

Desktop requests generic OPTRANE actions such as:

```text
POST /productions/:p/agents/register
POST /productions/:p/agents/:a/authorize
POST /productions/:p/agents/:a/improvements/propose
```

The Lovable backend privately handles governed identity registration, signed peer requests, provider authorization, evidence and budget synchronization. Public responses contain only normalized passport/trust/status/budget information.

## Self-improvement

The rule shown on the desktop and supplied to Gemini is:

> May improve reasoning strategy, prompts, retrieval order, tool ordering, error recovery and confidence thresholds. It may not add tools, expand permissions or data access, change model or executable code, modify governance policy, or increase any budget. Improvements are candidates only and require human approval before promotion.

Budget enforcement is server-side. Defaults:

```text
$0.25 maximum / improvement iteration
$2.00 maximum / day
2 improvement iterations / run
10 improvement iterations / day
```

The backend clamps user-configured values to hard maxima, checks local ledger state before Gemini executes, rejects any self-improvement Agent Runtime tool call, privately asks the governance provider to authorize the concrete candidate, and only then persists the candidate. Human approval creates a new immutable strategy configuration version; it never changes tools, permissions, model, policy or budget.

## Private peer administration

Private OPTRANE peer administration is deliberately not part of the desktop API:

```text
GET  /functions/v1/optrane-governance-admin/status
POST /functions/v1/optrane-governance-admin/claim
POST /functions/v1/optrane-governance-admin/verify
POST /functions/v1/optrane-governance-admin/ping
POST /functions/v1/optrane-governance-admin/close
```

All require `X-OPTRANE-Admin-Key` and are intended for manual backend setup/operations only.

The private server-to-server peer contract is maintained outside this repository and is not part of the desktop or public gateway surface.

## Recording demo endpoints

These endpoints exist only to make the hackathon recording deterministic for the configured verified test account. They still require an OPTRANE bearer session.

```http
POST /api/public/itrain-api/demo/prepare-recording
POST /api/public/itrain-api/demo/load-revision
```

Default allow-list:

```text
khrystynaklochko@gmail.com
```

Server setting:

```env
OPTRANE_RECORDING_TEST_EMAILS=khrystynaklochko@gmail.com
```

`prepare-recording` resets only the authenticated user's demo production and returns the NIGHTFALL v7 / 94% baseline. `load-revision` stages v8 and returns the four Scene 42 change previews. Neither endpoint bypasses normal membership, cloud integration, recovery approval, self-improvement budget, or governance enforcement.
