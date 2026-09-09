#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(new URL('..', import.meta.url).pathname);
const src=path.join(root,'src');
const allowedHosts=[
 'film-sparkle-layer.lovable.app',
];
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const sourceFiles=files(src).filter(f=>/\.(ts|tsx|js|jsx)$/.test(f));
const all=sourceFiles.map(f=>`// ${path.relative(root,f)}\n${fs.readFileSync(f,'utf8')}`).join('\n');
const checks=[];
function check(name,ok,detail=''){checks.push({name,ok,detail});}
check('No provider-native governance brand/route in Tauri source', !/agentcess/i.test(all));
check('No provider-native peer route in Tauri source', !/\/v1\/peers\/|\/system\/agentcess\//i.test(all));
check('No provider-native credential identifier in Tauri source', !/AGENTCESS_|GOVERNANCE_ADMIN_KEY|PRIVATE_KEY|WEBHOOK_SECRET/i.test(all));
check('No identity-provider SDK in Tauri source', !/@supabase|createClient\(|supabase\.auth|VITE_SUPABASE/i.test(all));
check('No direct Google/Vertex API in Tauri source', !/aiplatform\.googleapis\.com|GOOGLE_SERVICE_ACCOUNT|GOOGLE_CLOUD_PROJECT/i.test(all));
check('No direct ClickHouse/MCP credential in Tauri source', !/CLICKHOUSE_PASSWORD|MCP_CLICKHOUSE_TOKEN|OPTRANE_MCP_TOKEN/i.test(all));
const urls=[...all.matchAll(/https:\/\/[^'"`\s)]+/g)].map(m=>m[0]);
check('Only OPTRANE Lovable hosts are hard-coded in Tauri source', urls.every(u=>allowedHosts.some(h=>u.includes(h))), urls.join(', '));
check('Desktop session refreshes through OPTRANE gateway', /\/auth\/refresh/.test(fs.readFileSync(path.join(src,'api/session.ts'),'utf8')));
check('Desktop pairing exchanges verifier through OPTRANE gateway', /\/desktop-auth\/exchange/.test(fs.readFileSync(path.join(src,'api/browserAuth.ts'),'utf8')));
check('Self-improvement rule is shown in registration UI', /Self-improvement rule/.test(fs.readFileSync(path.join(src,'pages/AgentRegisterPage.tsx'),'utf8')));
check('Self-improvement budget cap is shown in registration UI', /Per improvement iteration/.test(fs.readFileSync(path.join(src,'pages/AgentRegisterPage.tsx'),'utf8')));
let bad=0;
for(const c of checks){if(!c.ok)bad++;console.log(`${c.ok?'✓':'✗'} ${c.name}${c.detail?` — ${c.detail}`:''}`)}
console.log(`\n${checks.length-bad}/${checks.length} security-boundary checks passed.`);
process.exitCode=bad?1:0;
