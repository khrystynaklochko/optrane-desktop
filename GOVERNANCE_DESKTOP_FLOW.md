# Governed agent desktop flow

## Registration

```text
AgentRegisterPage
    |
    | POST /agents/register
    v
OPTRANE Lovable backend
    |
    | server-to-server (private)
    v
governance provider
    |
    +-- passport
    +-- capabilities
    +-- tool bindings
    +-- data grants
    +-- policies
    +-- budget
    v
OPTRANE local mirror
    |
    v
AgentDetailPage
```

The desktop submits requested governance configuration; the backend owns provisioning. The desktop never supplies or receives provider credentials or native peer endpoints.

## Runtime

```text
Google ADK agent wants protected action
        |
        v
OPTRANE backend
        |
        v
governance provider authorization
  /          |             \
ALLOW       DENY      HOLD_FOR_APPROVAL
  |           |              |
execute     stop         human approval
  |
  v
result
  |
  v
normalized evidence
```

The desktop displays resulting status/evidence but cannot bypass a denial.

## Default fleet templates

The app includes templates for:

- Production Director
- Breakdown Agent
- Revision Agent
- Impact Agent
- Recovery Agent
- Schedule Agent
- Risk Agent
- Custom Agent

`Initialize AI Production Crew` registers the first five, one independent identity/passport each.

## Impact Agent default

Capabilities:

```text
SCRIPT_READ
PRODUCTION_READ
DEPENDENCY_QUERY
IMPACT_ANALYSIS
```

Tools:

```text
clickhouse.run_query        CLICKHOUSE_MCP / READ
optrane.production.read      OPTRANE / READ
optrane.scene.read           OPTRANE / READ
```

Data classes default to allowed except:

```text
PRODUCTION_FINANCIALS  CONDITIONAL
USER_PERSONAL_DATA     DENIED
SECRETS                DENIED
```

Budget:

```text
$1 / run
$10 / day
```

The user can change those requested settings before registration; the backend and governance provider remain authoritative over what is actually granted.
