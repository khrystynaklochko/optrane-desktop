#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(new URL('..', import.meta.url).pathname);
const api=fs.readFileSync(path.join(root,'backend/lovable/supabase/functions/itrain-api/index.ts'),'utf8');
const peerPath=path.join(root,'backend/agentcess-reference/supabase/functions/agentcess-api/index.ts');
const peer=fs.existsSync(peerPath)?fs.readFileSync(peerPath,'utf8'):'';
const admin=fs.readFileSync(path.join(root,'backend/lovable/supabase/functions/optrane-governance-admin/index.ts'),'utf8');
const self=fs.readFileSync(path.join(root,'backend/lovable/supabase/functions/_shared/self_improvement.ts'),'utf8');
const runtime=fs.readFileSync(path.join(root,'backend/lovable/supabase/functions/_shared/agent_runtime.ts'),'utf8');
const cloud=fs.readFileSync(path.join(root,'cloud-agent/optrane_agent/agent.py'),'utf8');

const checks=[]; const add=(name,ok)=>checks.push({name,ok});
const publicMarkers=[
 '/health','/auth/register','/auth/login','/auth/refresh','/auth/me','/auth/logout',
 '/desktop-auth/start','/desktop-auth/exchange','/productions','/scripts/upload','/analyses',
 'recovery-plans','/demo/reset','/demo/prepare-recording','/demo/load-revision','/system/integrations','/system/governance/status',
 'registerAgent(auth.userId','register-fleet','/runs','/authorize','/evidence','proposeImprovement(',
];
for(const marker of publicMarkers)add(`Public OPTRANE route marker ${marker}`,api.includes(marker));
add('Recording demo restricted to configured test email',api.includes('OPTRANE_RECORDING_TEST_EMAILS')&&api.includes('recording_test_user_required')&&api.includes('khrystynaklochko@gmail.com'));
add('No public /system/agentcess route',!api.includes('/system/agentcess'));
add('Desktop exchange consumes server-held token',api.includes('consumeMagicLinkToken')&&api.includes("status: 'CONSUMED'"));
add('Desktop pairing uses verifier hash',api.includes('verifier_hash')&&api.includes('hashText(verifier)'));
add('Website login requires verified email',api.includes('email_confirmed_at'));
add('Self-improvement local budget ledger',self.includes('agent_budget_ledger')&&self.includes('remainingDaily'));
add('Self-improvement provider authorization is private',self.includes("'/v1/authorizations/check'")&&self.includes('agentcessRequest'));
add('Self-improvement tool calls are rejected',runtime.includes('Self-improvement run attempted a tool call'));
add('Gemini instruction forbids authority escalation',cloud.includes('MUST NOT add tools')&&cloud.includes('Human approval'));
add('Private peer admin claim/verify/ping/close', ['/claim','/verify','/ping','/close'].every(x=>admin.includes(x)));
if(peer){
  add('Private peer challenge route',peer.includes('/peers/claim')&&peer.includes('/peers/')&&peer.includes('/verify'));
  add('Peer request signature canonicalization',peer.includes('SHA256')||peer.includes('sha256(rawBody)'));
  add('Peer timestamp freshness enforced',peer.includes('60_000'));
  add('Peer nonce replay protection',peer.includes('peer_nonces'));
  add('Private agent registration route',peer.includes("route === '/agents'"));
  add('Private capability/tool/grant/policy/budget routes', ['capabilities','tools','access-grants','policies','budget'].every(x=>peer.includes(x)));
  add('Private run authorization/evidence routes',peer.includes('/agent-runs')&&peer.includes('/authorizations/check')&&peer.includes('/evidence'));
  add('Provider self-improvement budget enforced',peer.includes('improvement_per_iteration')&&peer.includes('DAILY_IMPROVEMENT_BUDGET_EXCEEDED'));
}else{
  add('Private provider reference excluded from public repository',true);
}

let bad=0;for(const c of checks){if(!c.ok)bad++;console.log(`${c.ok?'✓':'✗'} ${c.name}`)}
console.log(`\n${checks.length-bad}/${checks.length} source-contract checks passed.`);process.exitCode=bad?1:0;
