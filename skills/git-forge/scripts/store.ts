// In-memory data model for the forge.
//
// One forge process serves one user: the token owner. The conformance scenario fixes that
// login (the scenario viewer), so the user record is a constant of the deployment and every
// repository lives under it. State is deliberately in-memory only: a trial is one process
// lifetime, and a deterministic logical clock (never the wall clock) keeps timestamps and
// therefore every derived byte reproducible across replays.

export const VIEWER = {
  login: 'adaiversen',
  id: 1000,
  name: 'ada iversen',
  email: 'adaiversen@example.invalid',
} as const;

/** One stored git object: its type and its raw (inflated) bytes. */
export interface GitObj {
  type: 'commit' | 'tree' | 'blob' | 'tag';
  data: Buffer;
}

export class ObjectStore {
  readonly objects = new Map<string, GitObj>();
  get(oid: string): GitObj | undefined {
    return this.objects.get(oid);
  }
  has(oid: string): boolean {
    return this.objects.has(oid);
  }
  set(oid: string, obj: GitObj): void {
    this.objects.set(oid, obj);
  }
}

export interface LabelRec {
  name: string;
  color: string;
  description: string | null;
}

export interface CommentRec {
  id: number;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface IssueRec {
  kind: 'issue';
  number: number;
  id: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  labels: string[];
  comments: CommentRec[];
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface PullRec {
  kind: 'pull';
  number: number;
  id: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  merged: boolean;
  mergedAt: string | null;
  mergeCommitSha: string | null;
  headRef: string;
  baseRef: string;
  headSha: string;
  baseSha: string;
  comments: CommentRec[];
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface RepoRec {
  dbId: number;
  owner: string;
  name: string;
  description: string;
  isPrivate: boolean;
  defaultBranch: string;
  createdAt: string;
  updatedAt: string;
  store: ObjectStore;
  /** Full ref name (refs/heads/main) -> object id. */
  refs: Map<string, string>;
  labels: Map<string, LabelRec>;
  issues: Map<number, IssueRec>;
  pulls: Map<number, PullRec>;
  /** Issues and pull requests share one per-repository number sequence, as on GitHub. */
  nextNumber: number;
}

const CLOCK_BASE_MS = Date.UTC(2025, 0, 1, 0, 0, 0);

export class Forge {
  readonly repos = new Map<string, RepoRec>();
  private nextRepoId = 1;
  private nextIssueId = 1;
  private nextCommentId = 1;
  private clockSeq = 0;

  /** Deterministic logical clock: each call advances one second past the previous. */
  nowIso(): string {
    this.clockSeq += 1;
    return new Date(CLOCK_BASE_MS + this.clockSeq * 1000).toISOString();
  }
  nowEpochSeconds(): number {
    return Math.floor(CLOCK_BASE_MS / 1000) + this.clockSeq;
  }
  allocIssueId(): number {
    const id = this.nextIssueId;
    this.nextIssueId += 1;
    return id;
  }
  allocCommentId(): number {
    const id = this.nextCommentId;
    this.nextCommentId += 1;
    return id;
  }

  private key(owner: string, name: string): string {
    return `${owner}/${name.toLowerCase()}`;
  }

  getRepo(owner: string, name: string): RepoRec | undefined {
    if (owner !== VIEWER.login) return undefined;
    return this.repos.get(this.key(owner, name));
  }

  createRepo(name: string, description: string, isPrivate: boolean): RepoRec | null {
    const key = this.key(VIEWER.login, name);
    if (this.repos.has(key)) return null;
    const ts = this.nowIso();
    const repo: RepoRec = {
      dbId: this.nextRepoId,
      owner: VIEWER.login,
      name,
      description,
      isPrivate,
      defaultBranch: 'main',
      createdAt: ts,
      updatedAt: ts,
      store: new ObjectStore(),
      refs: new Map(),
      labels: new Map(),
      issues: new Map(),
      pulls: new Map(),
      nextNumber: 1,
    };
    this.nextRepoId += 1;
    this.repos.set(key, repo);
    return repo;
  }

  deleteRepo(owner: string, name: string): boolean {
    if (owner !== VIEWER.login) return false;
    return this.repos.delete(this.key(owner, name));
  }

  listRepos(): RepoRec[] {
    return [...this.repos.values()].sort((a, b) => a.dbId - b.dbId);
  }
}

/** The one process-wide forge instance. */
export const forge = new Forge();

/** The git identity the forge itself commits as (contents writes, merges). */
export function forgeIdent(forgeInstance: Forge): string {
  return `${VIEWER.name} <${VIEWER.email}> ${forgeInstance.nowEpochSeconds()} +0000`;
}
