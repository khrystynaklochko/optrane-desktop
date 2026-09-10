export const env = {
  supabaseUrl: Deno.env.get('SUPABASE_URL') ?? '',
  serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  supabaseAnonKey: Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? '',
  geminiProvider: (Deno.env.get('GEMINI_PROVIDER') ?? 'vertex').toLowerCase(),
  geminiApiKey: Deno.env.get('GEMINI_API_KEY') ?? '',
  geminiModel: Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.5-flash',
  googleCloudProject: Deno.env.get('GOOGLE_CLOUD_PROJECT') ?? '',
  googleCloudLocation: Deno.env.get('GOOGLE_CLOUD_LOCATION') ?? 'global',
  googleServiceAccountJson: Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON') ?? '',
  clickhouseHttpUrl: (Deno.env.get('CLICKHOUSE_HTTP_URL') ?? '').replace(/\/$/, ''),
  clickhouseUser: Deno.env.get('CLICKHOUSE_USER') ?? '',
  clickhousePassword: Deno.env.get('CLICKHOUSE_PASSWORD') ?? '',
  mcpUrl: (Deno.env.get('CLICKHOUSE_MCP_URL') ?? '').replace(/\/$/, ''),
  mcpToken: Deno.env.get('CLICKHOUSE_MCP_TOKEN') ?? '',
  requireMcp: (Deno.env.get('OPTRANE_REQUIRE_MCP') ?? 'false').toLowerCase() === 'true',
  requireAgentRuntime: (Deno.env.get('OPTRANE_REQUIRE_AGENT_RUNTIME') ?? 'false').toLowerCase() === 'true',
  googleAgentEngineResource: Deno.env.get('GOOGLE_AGENT_ENGINE_RESOURCE') ?? '',
  demoMode: (Deno.env.get('OPTRANE_DEMO_MODE') ?? 'true').toLowerCase() === 'true',
  requireGovernance: (Deno.env.get('OPTRANE_REQUIRE_GOVERNANCE') ?? 'true').toLowerCase() === 'true',
  governanceAdminKey: Deno.env.get('OPTRANE_GOVERNANCE_ADMIN_KEY') ?? '',
  agentcessApiBase: (Deno.env.get('AGENTCESS_API_BASE') ?? '').replace(/\/$/, ''),
  agentcessClientId: Deno.env.get('AGENTCESS_CLIENT_ID') ?? '',
  agentcessClientSecret: Deno.env.get('AGENTCESS_CLIENT_SECRET') ?? '',
  agentcessPrivateKey: Deno.env.get('OPTRANE_AGENTCESS_PRIVATE_KEY') ?? '',
  agentcessPublicKey: Deno.env.get('OPTRANE_AGENTCESS_PUBLIC_KEY') ?? '',
  agentcessWorkspaceId: Deno.env.get('AGENTCESS_WORKSPACE_ID') ?? '',
  agentcessWebhookSecret: Deno.env.get('AGENTCESS_WEBHOOK_SECRET') ?? '',
};

export function assertServerConfiguration() {
  if (!env.supabaseUrl || !env.serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }
}
