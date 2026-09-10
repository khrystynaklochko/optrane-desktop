#!/usr/bin/env node
const CANONICAL='https://film-sparkle-layer.lovable.app';
const base=(process.env.OPTRANE_BASE_URL || CANONICAL).replace(/\/$/,'');
const api=`${base}/api/public/itrain-api`;
const token=process.env.OPTRANE_ACCESS_TOKEN || '';
const p=process.env.OPTRANE_PRODUCTION_ID || ':p';
const analysis=process.env.OPTRANE_ANALYSIS_ID || ':id';
const plan=process.env.OPTRANE_PLAN_ID || ':plan';
const agent=process.env.OPTRANE_AGENT_ID || ':a';
const candidate=process.env.OPTRANE_CANDIDATE_ID || ':candidate';
const authRequest=process.env.OPTRANE_DESKTOP_AUTH_REQUEST_ID || ':request';
const verifier=process.env.OPTRANE_DESKTOP_AUTH_VERIFIER || 'probe';

const routes=[
 ['GET','/health',false],
 ['POST','/auth/register',false],['POST','/auth/login',false],['POST','/auth/refresh',false],['GET','/auth/me',true],['POST','/auth/logout',true],
 ['POST','/desktop-auth/start',false],['GET',`/desktop-auth/${authRequest}/status?verifier=${encodeURIComponent(verifier)}`,false],['POST','/desktop-auth/exchange',false],['POST',`/desktop-auth/${authRequest}/approve`,true],
 ['GET','/productions',true],['POST','/productions',true],
 ['GET',`/productions/${p}/summary`,true],['GET',`/productions/${p}/graph`,true],['GET',`/productions/${p}/audit`,true],['GET',`/productions/${p}/evidence?limit=1&kinds=audit`,true],
 ['POST','/scripts/upload',true],['POST','/analyses',true],['GET',`/analyses/${analysis}`,true],['GET',`/analyses/${analysis}/events`,true],
 ['POST',`/recovery-plans/${plan}/approve`,true],['POST',`/recovery-plans/${plan}/reject`,true],['POST','/demo/reset',true],
 ['GET','/system/integrations',true],['GET','/system/governance/status',true],
 ['GET',`/productions/${p}/agents`,true],['POST',`/productions/${p}/agents/register`,true],['POST',`/productions/${p}/agents/register-fleet`,true],
 ['GET',`/productions/${p}/agents/${agent}`,true],['POST',`/productions/${p}/agents/${agent}/sync`,true],['POST',`/productions/${p}/agents/${agent}/retry-registration`,true],['POST',`/productions/${p}/agents/${agent}/revoke`,true],
 ['GET',`/productions/${p}/agents/${agent}/runs`,true],['POST',`/productions/${p}/agents/${agent}/runs`,true],['POST',`/productions/${p}/agents/${agent}/authorize`,true],
 ['GET',`/productions/${p}/agents/${agent}/evidence`,true],['POST',`/productions/${p}/agents/${agent}/evidence`,true],
 ['GET',`/productions/${p}/agents/${agent}/improvements`,true],['POST',`/productions/${p}/agents/${agent}/improvements/propose`,true],
 ['POST',`/productions/${p}/agents/${agent}/improvements/${candidate}/approve`,true],['POST',`/productions/${p}/agents/${agent}/improvements/${candidate}/reject`,true],
];

async function check([method,path,auth]){
 const headers={'x-optrane-client':'contract-verifier'};
 if(auth&&token) headers.Authorization=`Bearer ${token}`;
 let body;
 if(method==='POST' && path!=='/scripts/upload') {headers['Content-Type']='application/json';body='{}';}
 try{
  const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),8000);
  const r=await fetch(api+path,{method,headers,body,signal:controller.signal}); clearTimeout(timeout);
  const ok=r.status!==404;
  return {method,path,status:r.status,ok,note:!token&&auth?'expected auth protection':r.status===404?'MISSING':'present'};
 }catch(e){return {method,path,status:'ERR',ok:false,note:e.message};}
}

console.log(`OPTRANE Lovable contract verifier\nBase: ${base}\nToken: ${token?'provided':'not provided'}\n`);
let bad=0;
for(const route of routes){const r=await check(route);if(!r.ok)bad++;console.log(`${r.ok?'✓':'✗'} ${String(r.status).padEnd(4)} ${r.method.padEnd(4)} ${r.path}  ${r.note}`)}
console.log(`\n${routes.length-bad}/${routes.length} routes did not return 404.`);
process.exitCode=bad?1:0;
