import { env } from './env.ts';

function authHeader() {
  if (!env.clickhouseUser) return {};
  return { Authorization: `Basic ${btoa(`${env.clickhouseUser}:${env.clickhousePassword}`)}` };
}

export function clickhouseConfigured() {
  return Boolean(env.clickhouseHttpUrl && env.clickhouseUser);
}

export async function insertJsonEachRow(table: string, rows: Record<string, unknown>[]) {
  if (!rows.length || !clickhouseConfigured()) return false;
  const query = `INSERT INTO ${table} FORMAT JSONEachRow`;
  const body = `${query}\n${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
  const response = await fetch(env.clickhouseHttpUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain; charset=utf-8', ...authHeader() },
    body,
  });
  if (!response.ok) throw new Error(`ClickHouse write ${response.status}: ${await response.text()}`);
  return true;
}


export async function clickhousePing() {
  if (!clickhouseConfigured()) return false;
  try {
    const response = await fetch(env.clickhouseHttpUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8', ...authHeader() },
      body: 'SELECT 1 AS ok FORMAT JSON',
    });
    return response.ok;
  } catch {
    return false;
  }
}
