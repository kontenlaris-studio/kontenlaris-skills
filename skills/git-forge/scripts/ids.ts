// Global (GraphQL-style) object ids: opaque, stable, and never the plain database id.
// Format before base64: `<Kind>:<key>` where key is the database id for repositories
// and `<repoDbId>:<number>` for issues and pull requests.

export function gid(kind: string, key: string): string {
  return Buffer.from(`${kind}:${key}`, 'utf8').toString('base64');
}

export function repoGid(dbId: number): string {
  return gid('Repository', String(dbId));
}

export function issueGid(repoDbId: number, number: number): string {
  return gid('Issue', `${repoDbId}:${number}`);
}

export function pullGid(repoDbId: number, number: number): string {
  return gid('PullRequest', `${repoDbId}:${number}`);
}

export function commentGid(id: number): string {
  return gid('IssueComment', String(id));
}

export function userGid(login: string): string {
  return gid('User', login);
}

export interface ParsedGid {
  kind: string;
  key: string;
}

export function parseGid(id: string): ParsedGid | null {
  try {
    const text = Buffer.from(id, 'base64').toString('utf8');
    const colon = text.indexOf(':');
    if (colon <= 0) return null;
    return { kind: text.slice(0, colon), key: text.slice(colon + 1) };
  } catch {
    return null;
  }
}

/** Split a `<repoDbId>:<number>` key; null when malformed. */
export function parseRepoNumberKey(key: string): { repoDbId: number; number: number } | null {
  const parts = key.split(':');
  if (parts.length !== 2) return null;
  const repoDbId = Number(parts[0]);
  const number = Number(parts[1]);
  if (!Number.isInteger(repoDbId) || !Number.isInteger(number)) return null;
  return { repoDbId, number };
}
