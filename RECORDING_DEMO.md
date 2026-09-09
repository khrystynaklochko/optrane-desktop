# OPTRANE recording demo

Test account: `khrystynaklochko@gmail.com`

No password is hard-coded. Verify the account through the OPTRANE website and pair the desktop normally.

## Pre-recording

Open **Recording Workflow** from the sidebar and run:

1. **Prepare 94% baseline**
2. **Run preflight**
3. **Initialize governed crew**
4. **Stage four material changes**

At this point the app is staged for the demo while the competition-critical analysis remains live.

## Recording path

- Website verification / desktop pairing
- Control Room: NIGHTFALL 94%
- Change Review: 4 material changes
- Live analysis: Google Agent Runtime -> ADK -> official ClickHouse MCP `run_query`
- Impact: 94% -> 68%
- Recovery: Plan A / B / C, approve Plan B
- Readiness: 91%
- Impact Agent: self-improvement rule and caps ($0.25/iteration, $2/day, 2 iterations/run)
- Audit trail

The backend rejects recording-preparation endpoints for all accounts outside `OPTRANE_RECORDING_TEST_EMAILS`.
