export type ScriptFileKind = 'pdf' | 'text';

export interface ParsedScriptFile {
  kind: ScriptFileKind;
  name: string;
  /** Plain text for JSON upload; absent when kind is pdf. */
  content?: string;
  /** Original file for multipart PDF upload. */
  file?: File;
}

const SCRIPT_EXTENSIONS = ['.pdf', '.txt', '.fdx'] as const;

export function isScriptFile(file: File): boolean {
  const lower = file.name.toLowerCase();
  return SCRIPT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function stripFdxToPlainText(raw: string): string {
  const withoutTags = raw
    .replace(/<!\[CDATA\[([\s\S]*?)]]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  return withoutTags;
}

export async function parseScriptFile(file: File): Promise<ParsedScriptFile> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.pdf') || file.type === 'application/pdf') {
    return { kind: 'pdf', name: file.name, file };
  }
  if (lower.endsWith('.txt') || file.type.startsWith('text/')) {
    const content = (await file.text()).trim();
    if (!content) throw new Error('The text screenplay file is empty.');
    return { kind: 'text', name: file.name, content };
  }
  if (lower.endsWith('.fdx')) {
    const content = stripFdxToPlainText(await file.text());
    if (!content) throw new Error('Could not extract text from the Final Draft (.fdx) file.');
    return { kind: 'text', name: file.name.replace(/\.fdx$/i, '.txt'), content };
  }
  throw new Error('OPTRANE accepts screenplay PDF, plain text (.txt), or Final Draft (.fdx) files.');
}
