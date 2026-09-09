# OPTRANE public gateway API (`itrain-api` compatibility namespace)

Product: **OPTRANE Command**  
Public compatibility prefix: `/api/public/itrain-api`

## Base URLs

Canonical OPTRANE website:

```text
https://film-sparkle-layer.lovable.app/api/public/itrain-api
```

Canonical OPTRANE website:

```text
https://film-sparkle-layer.lovable.app/api/public/itrain-api
```

Business routes require:

```http
Authorization: Bearer <OPTRANE user access token>
x-optrane-client: desktop
```

The desktop obtains/refreshes this session only through the OPTRANE gateway. It does not use the identity provider SDK directly.

## Health

```http
GET /health
```

No authentication.

## Website account endpoints

### Register

```http
POST /auth/register
Content-Type: application/json
```

```json
{
  "email": "user@example.com",
  "password": "minimum-eight-characters",
  "displayName": "User"
}
```

Response:

```json
{
  "data": {
    "userId": "uuid",
    "verificationRequired": true,
    "email": "user@example.com"
  }
}
```

Registration is a website flow. OPTRANE Command does not collect passwords.

### Login

```http
POST /auth/login
```

```json
{ "email": "user@example.com", "password": "..." }
```

Email must be verified. Response contains a normal user session for the website:

```json
{
  "data": {
    "accessToken": "...",
    "refreshToken": "...",
    "expiresIn": 3600,
    "tokenType": "bearer",
    "user": { "id": "uuid", "email": "user@example.com", "displayName": "User" }
  }
}
```

### Refresh

```http
POST /auth/refresh
```

```json
{ "refreshToken": "..." }
```

Used by OPTRANE Command after the desktop session is established.

### Current user

```http
GET /auth/me
Authorization: Bearer <access token>
```

### Logout

```http
POST /auth/logout
Authorization: Bearer <access token>
```

## Secure website -> desktop pairing

### 1. Start

```http
POST /desktop-auth/start
```

```json
{
  "callbackUri": "optrane://auth/callback",
  "deviceName": "MacBook Pro",
  "platform": "macOS",
  "appVersion": "0.5.0"
}
```

Response:

```json
{
  "data": {
    "requestId": "uuid",
    "verifier": "high-entropy-device-verifier",
    "expiresAt": "...",
    "verificationUrl": "https://...lovable.app/desktop/verify?request_id=uuid"
  }
}
```

The verifier remains on the initiating device and is never placed in the deep link.

### 2. Website approval

Authenticated website only:

```http
POST /desktop-auth/:requestId/approve
Authorization: Bearer <verified website user token>
```

Response contains:

```json
{
  "data": {
    "status": "APPROVED",
    "callbackUri": "optrane://auth/callback?request_id=uuid"
  }
}
```

### 3. Optional state check

```http
GET /desktop-auth/:requestId/status?verifier=<device verifier>
```

Returns status only. It never returns an identity-provider token/hash.

### 4. One-use exchange

```http
POST /desktop-auth/exchange
```

```json
{
  "requestId": "uuid",
  "verifier": "high-entropy-device-verifier"
}
```

The gateway verifies request ownership, approval, expiry and exchange-attempt count, consumes its server-held one-time identity token, marks the request consumed, and returns the user session exactly once.

## Productions

```text
GET  /productions
POST /productions
GET  /productions/:productionId/summary
GET  /productions/:productionId/graph
GET  /productions/:productionId/audit
GET  /productions/:productionId/evidence?limit=200&since=<iso>&kinds=audit,ai,analysis,delta
POST /scripts/upload                       multipart form-data
POST /analyses
GET  /analyses/:analysisId
GET  /analyses/:analysisId/events         text/event-stream
POST /recovery-plans/:planId/approve
POST /recovery-plans/:planId/reject
POST /demo/reset
```

### Script upload

Multipart fields:

```text
productionId=<uuid>
kind=BASELINE | REVISION
file=<application/pdf>
```

The gateway stores the PDF privately and starts server-side screenplay processing. No storage service credential is returned to the desktop.

### Start analysis

```http
POST /analyses
```

```json
{ "productionId": "uuid", "revisionVersion": 2 }
```

The server owns all downstream Google/ClickHouse/governance calls.

## Integration status

```text
GET /system/integrations
GET /system/governance/status
```

Responses are normalized. They may include `connected`, `reachable`, trust/status and readiness, but never provider URLs, connection IDs, credentials, peer signatures/nonces or native policy data.

## Governed agents

```text
GET  /productions/:p/agents
POST /productions/:p/agents/register
POST /productions/:p/agents/register-fleet
GET  /productions/:p/agents/:a
POST /productions/:p/agents/:a/sync
POST /productions/:p/agents/:a/retry-registration
POST /productions/:p/agents/:a/revoke
GET  /productions/:p/agents/:a/runs
POST /productions/:p/agents/:a/runs
POST /productions/:p/agents/:a/authorize
GET  /productions/:p/agents/:a/evidence
POST /productions/:p/agents/:a/evidence
```

`POST .../evidence` is restricted to a user note. Provider evidence is written server-to-server and cannot be forged by the desktop.

### Register agent

```json
{
  "name": "Impact Agent",
  "agentType": "IMPACT",
  "purpose": "Identify production blast radius using verified evidence.",
  "runtime": "GOOGLE_ADK",
  "model": "gemini-3.5-flash",
  "capabilities": ["PRODUCTION_READ", "DEPENDENCY_QUERY", "IMPACT_ANALYSIS"],
  "tools": [{ "toolKey": "clickhouse.run_query", "provider": "CLICKHOUSE_MCP", "accessMode": "READ" }],
  "dataClasses": [{ "dataClass": "SCHEDULE", "access": "ALLOWED" }, { "dataClass": "SECRETS", "access": "DENIED" }],
  "budget": { "currency": "USD", "perRun": 1, "daily": 10 },
  "selfImprovement": {
    "enabled": true,
    "rule": "May improve reasoning strategy, prompts, retrieval order, tool ordering, error recovery and confidence thresholds. It may not add tools, expand permissions or data access, change model or executable code, modify governance policy, or increase any budget. Improvements are candidates only and require human approval before promotion.",
    "budget": { "currency": "USD", "perIteration": 0.25, "daily": 2, "maxIterationsPerRun": 2, "maxDailyIterations": 10 }
  }
}
```

The backend independently normalizes/clamps the policy and budget. The desktop cannot expand the hard server maxima.

## Self-improvement candidates

```text
GET  /productions/:p/agents/:a/improvements
POST /productions/:p/agents/:a/improvements/propose
POST /productions/:p/agents/:a/improvements/:candidateId/approve
POST /productions/:p/agents/:a/improvements/:candidateId/reject
```

`propose` asks Gemini for one candidate only. The server:

1. checks daily/per-run budget and iteration limits,
2. supplies the exact screen-displayed rule to the governed runtime,
3. rejects any self-improvement tool call,
4. validates the returned candidate type/content/cost,
5. privately asks the governance provider to authorize the concrete candidate,
6. writes the budget ledger,
7. returns the candidate.

Approval by a human creates a new immutable strategy version. It cannot change tools, permissions, data access, model, executable code, governance policy, secrets or budgets.

## Not public to the desktop

The following are deliberately absent from this API:

- provider peer claim/verify/ping/close endpoints,
- provider client credentials or access tokens,
- provider connection IDs/nonces/signatures,
- provider-native policy evaluation payloads,
- Google credentials,
- ClickHouse credentials,
- MCP bearer token,
- Supabase service-role key.

The provider webhook and private peer admin function are backend-only.
