// Repository operations shared by the REST, GraphQL and MCP surfaces: branch tips,
// contents reads/writes as real git commits, pull request diffs and merges. Keeping one
// implementation here is what makes the three surfaces agree with each other.

import { forge, forgeIdent, type PullRec, type RepoRec } from './store.ts';
import {
  buildTreeFromFlat,
  commitAncestors,
  flattenTree,
  isAncestor,
  lineDiff,
  makeCommit,
  mergeBase,
  parseCommit,
  peelToCommit,
  putObject,
  threeWayMerge,
} from './gitcore.ts';

export const ZERO = '0'.repeat(40);

/** The commit a branch points at, or null for an unborn/absent branch. */
export function branchTip(repo: RepoRec, branch: string): string | null {
  return repo.refs.get(`refs/heads/${branch}`) ?? null;
}

export function setBranch(repo: RepoRec, branch: string, oid: string): void {
  repo.refs.set(`refs/heads/${branch}`, oid);
}

/** Tree id of a commit, or of the empty tree when the commit does not exist. */
export function treeOfCommit(repo: RepoRec, commitOid: string | null): string {
  if (commitOid === null) return buildTreeFromFlat(repo.store, new Map());
  const obj = repo.store.get(commitOid);
  if (obj === undefined || obj.type !== 'commit') return buildTreeFromFlat(repo.store, new Map());
  return parseCommit(obj.data).tree;
}

/** Resolve a ref-ish (branch name or object id) to a commit id, or null. */
export function resolveCommit(repo: RepoRec, ref: string): string | null {
  const byBranch = branchTip(repo, ref);
  if (byBranch !== null) return peelToCommit(repo.store, byBranch);
  const obj = repo.store.get(ref);
  if (obj !== undefined) return peelToCommit(repo.store, ref);
  return null;
}

export interface ContentHit {
  mode: string;
  oid: string;
  size: number;
}

/** Look up one path on a branch; null when absent (or the branch is unborn). */
export function contentAt(repo: RepoRec, branch: string, path: string): ContentHit | null {
  const tip = branchTip(repo, branch);
  if (tip === null) return null;
  const flat = flattenTree(repo.store, treeOfCommit(repo, tip));
  const hit = flat.get(path);
  if (hit === undefined) return null;
  const obj = repo.store.get(hit.oid);
  return { mode: hit.mode, oid: hit.oid, size: obj === undefined ? 0 : obj.data.length };
}

/** Immediate children of a directory on a branch: name -> leaf or subtree marker. */
export function dirListing(repo: RepoRec, branch: string, dirPath: string): { name: string; path: string; type: 'file' | 'dir'; oid: string }[] | null {
  const tip = branchTip(repo, branch);
  if (tip === null) return null;
  const flat = flattenTree(repo.store, treeOfCommit(repo, tip));
  const prefix = dirPath === '' ? '' : `${dirPath}/`;
  const out = new Map<string, { name: string; path: string; type: 'file' | 'dir'; oid: string }>();
  for (const [path, leaf] of flat) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    if (rest === '') continue;
    const slash = rest.indexOf('/');
    if (slash === -1) {
      out.set(rest, { name: rest, path, type: 'file', oid: leaf.oid });
    } else {
      const dirName = rest.slice(0, slash);
      if (!out.has(dirName)) out.set(dirName, { name: dirName, path: prefix + dirName, type: 'dir', oid: subtreeOid(repo, tip, prefix + dirName) });
    }
  }
  // A path that exists as a file is not a directory; a path absent entirely is null.
  if (out.size === 0) {
    if (dirPath !== '' && flat.has(dirPath)) return [];
    if (dirPath !== '') {
      const any = [...flat.keys()].some((p) => p.startsWith(prefix));
      if (!any) return null;
    }
  }
  return [...out.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
}

function subtreeOid(repo: RepoRec, tip: string, dirPath: string): string {
  // Walk the tree objects to the directory and return its tree id (for listings).
  let treeOid = treeOfCommit(repo, tip);
  for (const segment of dirPath.split('/')) {
    const obj = repo.store.get(treeOid);
    if (obj === undefined || obj.type !== 'tree') return treeOid;
    const entries = new Map<string, string>();
    let pos = 0;
    const data = obj.data;
    while (pos < data.length) {
      const space = data.indexOf(0x20, pos);
      const nul = data.indexOf(0x00, space + 1);
      entries.set(data.toString('utf8', space + 1, nul), data.toString('hex', nul + 1, nul + 21));
      pos = nul + 21;
    }
    const next = entries.get(segment);
    if (next === undefined) return treeOid;
    treeOid = next;
  }
  return treeOid;
}

/**
 * Commit a single-file change onto a branch, creating the branch (from the default
 * branch tip) when it does not exist yet. Returns the new commit id and whether the
 * file already existed.
 */
export function commitContent(
  repo: RepoRec,
  branch: string,
  path: string,
  content: Buffer | null,
  message: string,
): { commit: string; existed: boolean } {
  let tip = branchTip(repo, branch);
  if (tip === null && branch !== repo.defaultBranch) {
    tip = branchTip(repo, repo.defaultBranch);
  }
  const flat = flattenTree(repo.store, treeOfCommit(repo, tip));
  const existed = flat.has(path);
  if (content === null) flat.delete(path);
  else {
    const blobOid = putObject(repo.store, 'blob', content);
    const prior = flat.get(path);
    flat.set(path, { mode: prior?.mode ?? '100644', oid: blobOid });
  }
  const tree = buildTreeFromFlat(repo.store, flat);
  const commit = makeCommit(repo.store, {
    tree,
    parents: tip === null ? [] : [tip],
    message,
    ident: forgeIdent(forge),
  });
  setBranch(repo, branch, commit);
  repo.updatedAt = forge.nowIso();
  return { commit, existed };
}

export interface FileChange {
  filename: string;
  status: 'added' | 'removed' | 'modified';
  additions: number;
  deletions: number;
  changes: number;
}

/** File-level diff between a pull request's merge base and its head. */
export function pullFiles(repo: RepoRec, pull: PullRec): FileChange[] {
  const headTip = branchTip(repo, pull.headRef) ?? pull.headSha;
  const baseTip = branchTip(repo, pull.baseRef) ?? pull.baseSha;
  const base = mergeBase(repo.store, peelToCommit(repo.store, baseTip), peelToCommit(repo.store, headTip));
  const fromFlat = flattenTree(repo.store, treeOfCommit(repo, base));
  const toFlat = flattenTree(repo.store, treeOfCommit(repo, peelToCommit(repo.store, headTip)));
  const paths = new Set<string>([...fromFlat.keys(), ...toFlat.keys()]);
  const out: FileChange[] = [];
  for (const path of [...paths].sort()) {
    const from = fromFlat.get(path);
    const to = toFlat.get(path);
    if (from !== undefined && to !== undefined && from.oid === to.oid) continue;
    const oldData = from === undefined ? Buffer.alloc(0) : repo.store.get(from.oid)?.data ?? Buffer.alloc(0);
    const newData = to === undefined ? Buffer.alloc(0) : repo.store.get(to.oid)?.data ?? Buffer.alloc(0);
    const { additions, deletions } = lineDiff(oldData, newData);
    out.push({
      filename: path,
      status: from === undefined ? 'added' : to === undefined ? 'removed' : 'modified',
      additions,
      deletions,
      changes: additions + deletions,
    });
  }
  return out;
}

/** Whether the pull request would merge cleanly right now (three-way dry run). */
export function pullMergeable(repo: RepoRec, pull: PullRec): boolean {
  const headTip = branchTip(repo, pull.headRef) ?? pull.headSha;
  const baseTip = branchTip(repo, pull.baseRef) ?? pull.baseSha;
  const headCommit = peelToCommit(repo.store, headTip);
  const baseCommit = peelToCommit(repo.store, baseTip);
  if (isAncestor(repo.store, headCommit, baseCommit)) return true;
  const base = mergeBase(repo.store, baseCommit, headCommit);
  const outcome = threeWayMerge(
    repo.store,
    treeOfCommit(repo, base),
    treeOfCommit(repo, baseCommit),
    treeOfCommit(repo, headCommit),
  );
  return outcome.ok;
}

export interface MergeResult {
  ok: boolean;
  sha?: string;
  reason?: string;
}

/** Merge a pull request into its base branch: squash or true merge commit. */
export function mergePull(repo: RepoRec, pull: PullRec, method: 'squash' | 'merge'): MergeResult {
  if (pull.merged) return { ok: false, reason: 'already-merged' };
  if (pull.state === 'closed') return { ok: false, reason: 'closed' };
  const headTip = branchTip(repo, pull.headRef) ?? pull.headSha;
  const baseTip = branchTip(repo, pull.baseRef) ?? pull.baseSha;
  const headCommit = peelToCommit(repo.store, headTip);
  const baseCommit = peelToCommit(repo.store, baseTip);
  const base = mergeBase(repo.store, baseCommit, headCommit);
  const outcome = threeWayMerge(
    repo.store,
    treeOfCommit(repo, base),
    treeOfCommit(repo, baseCommit),
    treeOfCommit(repo, headCommit),
  );
  if (!outcome.ok || outcome.tree === null) return { ok: false, reason: 'conflict' };
  let message: string;
  let parents: string[];
  if (method === 'merge') {
    message = `Merge pull request #${pull.number} from ${pull.headRef}\n\n${pull.title}`;
    parents = headCommit === baseCommit ? [baseCommit] : [baseCommit, headCommit];
  } else {
    message = pull.body === '' ? `${pull.title} (#${pull.number})` : `${pull.title} (#${pull.number})\n\n${pull.body}`;
    parents = [baseCommit];
  }
  const commit = makeCommit(repo.store, {
    tree: outcome.tree,
    parents,
    message,
    ident: forgeIdent(forge),
  });
  setBranch(repo, pull.baseRef, commit);
  const ts = forge.nowIso();
  pull.merged = true;
  pull.mergedAt = ts;
  pull.mergeCommitSha = commit;
  pull.state = 'closed';
  pull.closedAt = ts;
  pull.updatedAt = ts;
  repo.updatedAt = ts;
  return { ok: true, sha: commit };
}

/** Current head/base shas for a pull request (live branch tips win over snapshots). */
export function pullShas(repo: RepoRec, pull: PullRec): { headSha: string; baseSha: string } {
  return {
    headSha: branchTip(repo, pull.headRef) ?? pull.headSha,
    baseSha: branchTip(repo, pull.baseRef) ?? pull.baseSha,
  };
}

/** Newest-first commit list from a starting commit (REST /commits). */
export function commitList(repo: RepoRec, start: string, limit: number): { sha: string; message: string; author: string; committer: string; parents: string[]; tree: string }[] {
  return commitAncestors(repo.store, start)
    .slice(0, limit)
    .map((sha) => {
      const parsed = parseCommit(repo.store.get(sha)?.data ?? Buffer.alloc(0));
      return { sha, message: parsed.message, author: parsed.author, committer: parsed.committer, parents: parsed.parents, tree: parsed.tree };
    });
}
