// REST v3 surface under /api/v3. Every reply is a JSON value; errors carry {message};
// the app wrapper adds the X-GitHub-Request-Id header and content type to all of them.

import { forge, VIEWER, type IssueRec, type PullRec, type RepoRec } from './store.ts';
import { commentGid, issueGid, pullGid, repoGid, userGid } from './ids.ts';
import {
  branchTip,
  commitContent,
  commitList,
  contentAt,
  dirListing,
  mergePull,
  pullFiles,
  pullShas,
  resolveCommit,
  setBranch,
} from './repops.ts';
import { isOid } from './gitcore.ts';

export interface Ctx {
  method: string;
  query: URLSearchParams;
  body: Buffer;
  json: unknown;
  jsonError: boolean;
  host: string;
}

export interface Reply {
  status: number;
  body?: unknown;
  /** Pre-serialized JSON body; when present the app sends these bytes verbatim. */
  raw?: Buffer;
  headers?: Record<string, string>;
}

const notFound = (): Reply => ({ status: 404, body: { message: 'Not Found' } });
const badJson = (): Reply => ({ status: 400, body: { message: 'Problems parsing JSON' } });
const unprocessable = (message: string): Reply => ({ status: 422, body: { message } });

function bodyObject(ctx: Ctx): Record<string, unknown> {
  if (ctx.json !== null && typeof ctx.json === 'object' && !Array.isArray(ctx.json)) {
    return ctx.json as Record<string, unknown>;
  }
  return {};
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function pagination(ctx: Ctx): { page: number; perPage: number } {
  const page = Math.max(1, parseInt(ctx.query.get('page') ?? '1', 10) || 1);
  const perPage = Math.min(100, Math.max(1, parseInt(ctx.query.get('per_page') ?? '30', 10) || 30));
  return { page, perPage };
}

function paginate<T>(items: T[], ctx: Ctx, basePath: string): Reply {
  const { page, perPage } = pagination(ctx);
  const totalPages = Math.max(1, Math.ceil(items.length / perPage));
  const slice = items.slice((page - 1) * perPage, page * perPage);
  const headers: Record<string, string> = {};
  if (page < totalPages || page > 1) {
    const url = (p: number): string => `<http://${ctx.host}${basePath}?page=${p}&per_page=${perPage}>`;
    const links: string[] = [];
    if (page < totalPages) {
      links.push(`${url(page + 1)}; rel="next"`, `${url(totalPages)}; rel="last"`);
    }
    if (page > 1) {
      links.push(`${url(1)}; rel="first"`, `${url(page - 1)}; rel="prev"`);
    }
    if (links.length > 0) headers.Link = links.join(', ');
  }
  return { status: 200, body: slice, headers };
}

// ---------------------------------------------------------------------------
// Serializers (shared with the MCP tools so the surfaces agree byte-for-byte)

/**
 * The viewer's JSON shape is a constant of the deployment (one user, fixed
 * fields), so it is built once and shared; serializers only ever read it.
 */
const USER_JSON: Record<string, unknown> = {
  login: VIEWER.login,
  id: VIEWER.id,
  node_id: userGid(VIEWER.login),
  type: 'User',
  site_admin: false,
  name: VIEWER.name,
  email: VIEWER.email,
};

export function userJson(): Record<string, unknown> {
  return USER_JSON;
}

export function repoJson(repo: RepoRec): Record<string, unknown> {
  const openIssues = [...repo.issues.values()].filter((i) => i.state === 'open').length
    + [...repo.pulls.values()].filter((p) => p.state === 'open').length;
  return {
    id: repo.dbId,
    node_id: repoGid(repo.dbId),
    name: repo.name,
    full_name: `${repo.owner}/${repo.name}`,
    owner: { login: repo.owner, id: VIEWER.id, node_id: userGid(repo.owner), type: 'User' },
    private: repo.isPrivate,
    description: repo.description,
    default_branch: repo.defaultBranch,
    created_at: repo.createdAt,
    updated_at: repo.updatedAt,
    pushed_at: repo.updatedAt,
    html_url: '',
    url: '',
    git_url: '',
    ssh_url: '',
    clone_url: '',
    size: 0,
    stargazers_count: 0,
    watchers_count: 0,
    forks_count: 0,
    open_issues_count: openIssues,
    has_issues: true,
    has_projects: true,
    has_downloads: true,
    has_wiki: true,
    has_pages: false,
    archived: false,
    disabled: false,
    visibility: repo.isPrivate ? 'private' : 'public',
    fork: false,
    topics: [],
    license: null,
    language: null,
  };
}

function labelJson(repo: RepoRec, name: string): Record<string, unknown> {
  const label = repo.labels.get(name);
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return {
    id: 5000 + Math.abs(hash % 100000),
    node_id: '',
    name,
    color: label?.color ?? 'ededed',
    description: label?.description ?? null,
    default: false,
    url: '',
  };
}

export function issueJson(repo: RepoRec, issue: IssueRec): Record<string, unknown> {
  return {
    id: issue.id,
    node_id: issueGid(repo.dbId, issue.number),
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state,
    labels: issue.labels.map((name) => labelJson(repo, name)),
    user: userJson(),
    comments: issue.comments.length,
    created_at: issue.createdAt,
    updated_at: issue.updatedAt,
    closed_at: issue.closedAt,
    url: '',
    html_url: '',
    repository_url: '',
    labels_url: '',
    comments_url: '',
    events_url: '',
  };
}

/**
 * Serialized GET-issue replies, memoized per issue record. The cache key is
 * the pair (updatedAt, comment count): every mutation an issue can undergo —
 * REST PATCH, a GraphQL close, a new comment — either stamps a fresh
 * updatedAt (the logical clock ticks on every write) or grows the comment
 * list, and title/body/state/labels/closedAt are only ever written together
 * with that updatedAt stamp. The remaining serializer inputs cannot change
 * for an existing issue either: it belongs to one repo for life, and label
 * records are never edited or deleted once created.
 */
const issueBodyCache = new WeakMap<IssueRec, { updatedAt: string; comments: number; raw: Buffer }>();

function issueGetReply(repo: RepoRec, issue: IssueRec): Reply {
  const cached = issueBodyCache.get(issue);
  if (cached !== undefined && cached.updatedAt === issue.updatedAt && cached.comments === issue.comments.length) {
    return { status: 200, raw: cached.raw };
  }
  const raw = Buffer.from(JSON.stringify(issueJson(repo, issue)), 'utf8');
  issueBodyCache.set(issue, { updatedAt: issue.updatedAt, comments: issue.comments.length, raw });
  return { status: 200, raw };
}

export function commentJson(repo: RepoRec, comment: { id: number; body: string; createdAt: string; updatedAt: string }): Record<string, unknown> {
  void repo;
  return {
    id: comment.id,
    node_id: commentGid(comment.id),
    body: comment.body,
    user: userJson(),
    created_at: comment.createdAt,
    updated_at: comment.updatedAt,
    url: '',
    html_url: '',
    issue_url: '',
  };
}

export function pullJson(repo: RepoRec, pull: PullRec): Record<string, unknown> {
  const { headSha, baseSha } = pullShas(repo, pull);
  return {
    id: pull.id,
    node_id: pullGid(repo.dbId, pull.number),
    number: pull.number,
    state: pull.state,
    title: pull.title,
    body: pull.body,
    merged: pull.merged,
    merged_at: pull.mergedAt,
    merge_commit_sha: pull.mergeCommitSha,
    head: { ref: pull.headRef, sha: headSha, label: `${repo.owner}:${pull.headRef}` },
    base: { ref: pull.baseRef, sha: baseSha, label: `${repo.owner}:${pull.baseRef}` },
    user: userJson(),
    created_at: pull.createdAt,
    updated_at: pull.updatedAt,
    closed_at: pull.closedAt,
    url: '',
    html_url: '',
    diff_url: '',
    patch_url: '',
    issue_url: '',
    _links: {},
  };
}

// ---------------------------------------------------------------------------
// Domain operations (shared with MCP)

export function createIssue(repo: RepoRec, input: { title: string; body: string; labels: string[] }): IssueRec | { error: string } {
  for (const name of input.labels) {
    if (!repo.labels.has(name)) return { error: `Validation Failed: label "${name}" does not exist` };
  }
  const ts = forge.nowIso();
  const issue: IssueRec = {
    kind: 'issue',
    number: repo.nextNumber,
    id: forge.allocIssueId(),
    title: input.title,
    body: input.body,
    state: 'open',
    labels: [...input.labels],
    comments: [],
    createdAt: ts,
    updatedAt: ts,
    closedAt: null,
  };
  repo.nextNumber += 1;
  repo.issues.set(issue.number, issue);
  return issue;
}

export function createPull(repo: RepoRec, input: { title: string; body: string; head: string; base: string }): PullRec | { error: string } {
  const headSha = branchTip(repo, input.head);
  const baseSha = branchTip(repo, input.base);
  if (headSha === null) return { error: `Validation Failed: head branch "${input.head}" does not exist` };
  if (baseSha === null) return { error: `Validation Failed: base branch "${input.base}" does not exist` };
  if (input.head === input.base) return { error: 'Validation Failed: head and base are the same' };
  for (const existing of repo.pulls.values()) {
    if (existing.state === 'open' && existing.headRef === input.head && existing.baseRef === input.base) {
      return { error: 'Validation Failed: a pull request already exists for this head and base' };
    }
  }
  const ts = forge.nowIso();
  const pull: PullRec = {
    kind: 'pull',
    number: repo.nextNumber,
    id: forge.allocIssueId(),
    title: input.title,
    body: input.body,
    state: 'open',
    merged: false,
    mergedAt: null,
    mergeCommitSha: null,
    headRef: input.head,
    baseRef: input.base,
    headSha,
    baseSha,
    comments: [],
    createdAt: ts,
    updatedAt: ts,
    closedAt: null,
  };
  repo.nextNumber += 1;
  repo.pulls.set(pull.number, pull);
  return pull;
}

// ---------------------------------------------------------------------------
// Routing

export function routeRest(segments: string[], ctx: Ctx): Reply {
  const seg = segments;
  // /api/v3 itself
  if (seg.length === 2) {
    if (ctx.method === 'GET') {
      return {
        status: 200,
        body: { current_user_url: '', repository_url: '', issue_url: '', emojis_url: '' },
        headers: { 'X-OAuth-Scopes': 'repo, user' },
      };
    }
    return notFound();
  }
  if (seg[2] === 'meta' && seg.length === 3 && ctx.method === 'GET') {
    return { status: 200, body: { verifiable_password_authentication: false, installed_version: 'forge-2.0.0', api: ['3'] } };
  }
  if (seg[2] === 'user' && seg.length === 3 && ctx.method === 'GET') {
    return { status: 200, body: userJson() };
  }
  if (seg[2] === 'user' && seg[3] === 'repos' && seg.length === 4) {
    if (ctx.method === 'GET') {
      return paginate(forge.listRepos().map(repoJson), ctx, '/api/v3/user/repos');
    }
    if (ctx.method === 'POST') {
      if (ctx.jsonError) return badJson();
      const body = bodyObject(ctx);
      const name = str(body.name);
      if (name === undefined || name === '' || name.includes('/') || name.includes(' ')) {
        return unprocessable('Validation Failed: name is invalid');
      }
      const repo = forge.createRepo(name, str(body.description) ?? '', body.private === true);
      if (repo === null) return unprocessable('Validation Failed: name already exists on this account');
      if (body.auto_init === true) {
        commitContent(repo, repo.defaultBranch, 'README.md', Buffer.from(`# ${name}\n`, 'utf8'), 'Initial commit');
      }
      return { status: 201, body: repoJson(repo) };
    }
    return notFound();
  }
  if (seg[2] === 'repos' && seg.length >= 5) {
    const repo = forge.getRepo(seg[3], seg[4]);
    if (repo === undefined) return notFound();
    return routeRepo(repo, seg.slice(5), ctx);
  }
  return notFound();
}

function routeRepo(repo: RepoRec, rest: string[], ctx: Ctx): Reply {
  // /repos/{owner}/{repo}
  if (rest.length === 0) {
    if (ctx.method === 'GET') return { status: 200, body: repoJson(repo) };
    if (ctx.method === 'PATCH') {
      if (ctx.jsonError) return badJson();
      const body = bodyObject(ctx);
      if (typeof body.description === 'string') repo.description = body.description;
      if (typeof body.private === 'boolean') repo.isPrivate = body.private;
      if (typeof body.default_branch === 'string' && body.default_branch !== '') repo.defaultBranch = body.default_branch;
      if (typeof body.name === 'string' && body.name !== '' && body.name !== repo.name) {
        const clash = forge.getRepo(repo.owner, body.name);
        if (clash !== undefined) return unprocessable('Validation Failed: name already exists on this account');
        forge.repos.delete(`${repo.owner}/${repo.name.toLowerCase()}`);
        repo.name = body.name;
        forge.repos.set(`${repo.owner}/${repo.name.toLowerCase()}`, repo);
      }
      repo.updatedAt = forge.nowIso();
      return { status: 200, body: repoJson(repo) };
    }
    if (ctx.method === 'DELETE') {
      forge.deleteRepo(repo.owner, repo.name);
      return { status: 204 };
    }
    return notFound();
  }

  const [head, ...tail] = rest;

  if (head === 'branches') {
    if (tail.length === 0 && ctx.method === 'GET') {
      const branches = [...repo.refs.keys()]
        .filter((ref) => ref.startsWith('refs/heads/'))
        .map((ref) => ({ name: ref.slice('refs/heads/'.length), commit: { sha: repo.refs.get(ref) as string }, protected: false }));
      return { status: 200, body: branches };
    }
    if (tail.length >= 1 && ctx.method === 'GET') {
      const branch = tail.join('/');
      const tip = branchTip(repo, branch);
      if (tip === null) return notFound();
      return { status: 200, body: { name: branch, commit: { sha: tip }, protected: false } };
    }
    return notFound();
  }

  if (head === 'commits' && tail.length === 0 && ctx.method === 'GET') {
    const shaParam = ctx.query.get('sha') ?? repo.defaultBranch;
    const start = resolveCommit(repo, shaParam);
    if (start === null) return { status: 200, body: [] };
    const { perPage } = pagination(ctx);
    const list = commitList(repo, start, perPage).map((entry) => ({
      sha: entry.sha,
      commit: {
        message: entry.message,
        tree: { sha: entry.tree },
        author: parseIdent(entry.author),
        committer: parseIdent(entry.committer),
      },
      parents: entry.parents.map((sha) => ({ sha })),
      url: '',
      html_url: '',
    }));
    return { status: 200, body: list };
  }

  if (head === 'git' && tail[0] === 'refs') {
    if (tail.length === 1 && ctx.method === 'POST') {
      if (ctx.jsonError) return badJson();
      const body = bodyObject(ctx);
      const ref = str(body.ref);
      const sha = str(body.sha);
      if (ref === undefined || sha === undefined || !isOid(sha)) return unprocessable('Validation Failed: ref and sha are required');
      if (repo.refs.has(ref)) return unprocessable('Validation Failed: reference already exists');
      const obj = repo.store.get(sha);
      if (obj === undefined) return unprocessable('Validation Failed: sha does not exist');
      repo.refs.set(ref, sha);
      return { status: 201, body: { ref, node_id: '', url: '', object: { sha, type: obj.type } } };
    }
    if (tail.length >= 3 && tail[1] === 'heads' && ctx.method === 'GET') {
      const branch = tail.slice(2).join('/');
      const tip = branchTip(repo, branch);
      if (tip === null) return notFound();
      const obj = repo.store.get(tip);
      return { status: 200, body: { ref: `refs/heads/${branch}`, node_id: '', url: '', object: { sha: tip, type: obj?.type ?? 'commit' } } };
    }
    return notFound();
  }

  if (head === 'contents') {
    return routeContents(repo, tail.join('/'), ctx);
  }

  if (head === 'labels') {
    if (tail.length === 0 && ctx.method === 'POST') {
      if (ctx.jsonError) return badJson();
      const body = bodyObject(ctx);
      const name = str(body.name);
      if (name === undefined || name === '') return unprocessable('Validation Failed: name is required');
      if (repo.labels.has(name)) return unprocessable('Validation Failed: label already exists');
      repo.labels.set(name, { name, color: str(body.color) ?? 'ededed', description: str(body.description) ?? null });
      return { status: 201, body: labelJson(repo, name) };
    }
    if (tail.length === 0 && ctx.method === 'GET') {
      return { status: 200, body: [...repo.labels.keys()].map((name) => labelJson(repo, name)) };
    }
    return notFound();
  }

  if (head === 'issues') return routeIssues(repo, tail, ctx);
  if (head === 'pulls') return routePulls(repo, tail, ctx);
  return notFound();
}

function parseIdent(line: string): { name: string; email: string; date: string } {
  const match = /^(.*?) <(.*?)> (\d+) [+-]\d{4}$/.exec(line);
  if (match === null) return { name: line, email: '', date: new Date(0).toISOString() };
  return { name: match[1], email: match[2], date: new Date(parseInt(match[3], 10) * 1000).toISOString() };
}

function routeContents(repo: RepoRec, path: string, ctx: Ctx): Reply {
  const body = bodyObject(ctx);
  if (ctx.method === 'GET') {
    const ref = ctx.query.get('ref') ?? repo.defaultBranch;
    if (path === '') {
      const listing = dirListing(repo, ref, '');
      if (listing === null) return { status: 200, body: [] };
      return { status: 200, body: listing.map(listingEntry) };
    }
    const hit = contentAt(repo, ref, path);
    if (hit !== null) {
      const data = repo.store.get(hit.oid)?.data ?? Buffer.alloc(0);
      const name = path.split('/').pop() as string;
      return {
        status: 200,
        body: {
          type: 'file',
          encoding: 'base64',
          content: wrapBase64(data),
          sha: hit.oid,
          size: data.length,
          name,
          path,
          url: '',
          html_url: '',
          download_url: '',
        },
      };
    }
    const listing = dirListing(repo, ref, path);
    if (listing !== null) return { status: 200, body: listing.map(listingEntry) };
    return notFound();
  }
  if (ctx.method === 'PUT') {
    if (ctx.jsonError) return badJson();
    const message = str(body.message);
    const contentB64 = str(body.content);
    if (message === undefined || contentB64 === undefined) return unprocessable('Validation Failed: message and content are required');
    const branch = str(body.branch) ?? repo.defaultBranch;
    const existing = contentAt(repo, branch, path);
    const shaGiven = str(body.sha);
    if (shaGiven !== undefined && (existing === null || existing.oid !== shaGiven)) {
      return { status: 409, body: { message: 'Conflict: sha does not match the current content' } };
    }
    let data: Buffer;
    try {
      data = Buffer.from(contentB64.replace(/\s+/g, ''), 'base64');
    } catch {
      return unprocessable('Validation Failed: content is not valid base64');
    }
    const { commit } = commitContent(repo, branch, path, data, message);
    const blobOid = contentAt(repo, branch, path)?.oid as string;
    return {
      status: existing === null ? 201 : 200,
      body: {
        content: { name: path.split('/').pop(), path, sha: blobOid, size: data.length, type: 'file', encoding: 'base64', url: '', html_url: '' },
        commit: { sha: commit, message, url: '', html_url: '' },
      },
    };
  }
  if (ctx.method === 'DELETE') {
    if (ctx.jsonError) return badJson();
    const message = str(body.message);
    if (message === undefined) return unprocessable('Validation Failed: message is required');
    const branch = str(body.branch) ?? repo.defaultBranch;
    const existing = contentAt(repo, branch, path);
    if (existing === null) return notFound();
    const shaGiven = str(body.sha);
    if (shaGiven !== undefined && existing.oid !== shaGiven) {
      return { status: 409, body: { message: 'Conflict: sha does not match the current content' } };
    }
    const { commit } = commitContent(repo, branch, path, null, message);
    return { status: 200, body: { content: null, commit: { sha: commit, message, url: '', html_url: '' } } };
  }
  return notFound();
}

function listingEntry(entry: { name: string; path: string; type: 'file' | 'dir'; oid: string }): Record<string, unknown> {
  return { type: entry.type === 'dir' ? 'dir' : 'file', name: entry.name, path: entry.path, sha: entry.oid, size: 0, url: '', html_url: '' };
}

function wrapBase64(data: Buffer): string {
  const b64 = data.toString('base64');
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 60) lines.push(b64.slice(i, i + 60));
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

function routeIssues(repo: RepoRec, tail: string[], ctx: Ctx): Reply {
  if (tail.length === 0) {
    if (ctx.method === 'POST') {
      if (ctx.jsonError) return badJson();
      const body = bodyObject(ctx);
      const title = str(body.title);
      if (title === undefined || title === '') return unprocessable('Validation Failed: title is required');
      const labels = Array.isArray(body.labels) ? body.labels.filter((l): l is string => typeof l === 'string') : [];
      const created = createIssue(repo, { title, body: str(body.body) ?? '', labels });
      if ('error' in created) return unprocessable(created.error);
      return { status: 201, body: issueJson(repo, created) };
    }
    if (ctx.method === 'GET') {
      const state = ctx.query.get('state') ?? 'open';
      let issues = [...repo.issues.values()];
      if (state === 'open') issues = issues.filter((i) => i.state === 'open');
      else if (state === 'closed') issues = issues.filter((i) => i.state === 'closed');
      const sort = ctx.query.get('sort') ?? 'created';
      const direction = ctx.query.get('direction') ?? 'desc';
      void sort;
      issues.sort((a, b) => (direction === 'asc' ? a.number - b.number : b.number - a.number));
      const { page, perPage } = pagination(ctx);
      const slice = issues.slice((page - 1) * perPage, page * perPage);
      return { status: 200, body: slice.map((i) => issueJson(repo, i)) };
    }
    return notFound();
  }
  const number = parseInt(tail[0], 10);
  const issue = Number.isInteger(number) ? repo.issues.get(number) : undefined;
  const pullTarget = Number.isInteger(number) ? repo.pulls.get(number) : undefined;
  if (tail.length === 1) {
    if (issue === undefined) return notFound();
    if (ctx.method === 'GET') return issueGetReply(repo, issue);
    if (ctx.method === 'PATCH') {
      if (ctx.jsonError) return badJson();
      const body = bodyObject(ctx);
      if (typeof body.title === 'string') issue.title = body.title;
      if (typeof body.body === 'string') issue.body = body.body;
      if (Array.isArray(body.labels)) {
        const labels = body.labels.filter((l): l is string => typeof l === 'string');
        for (const name of labels) if (!repo.labels.has(name)) return unprocessable(`Validation Failed: label "${name}" does not exist`);
        issue.labels = labels;
      }
      if (body.state === 'closed' || body.state === 'open') {
        issue.state = body.state;
        issue.closedAt = body.state === 'closed' ? forge.nowIso() : null;
      }
      issue.updatedAt = forge.nowIso();
      return { status: 200, body: issueJson(repo, issue) };
    }
    return notFound();
  }
  if (tail.length === 2 && tail[1] === 'comments') {
    const host = issue ?? pullTarget;
    if (host === undefined) return notFound();
    if (ctx.method === 'POST') {
      if (ctx.jsonError) return badJson();
      const body = bodyObject(ctx);
      const text = str(body.body);
      if (text === undefined) return unprocessable('Validation Failed: body is required');
      const ts = forge.nowIso();
      const comment = { id: forge.allocCommentId(), body: text, createdAt: ts, updatedAt: ts };
      host.comments.push(comment);
      return { status: 201, body: commentJson(repo, comment) };
    }
    if (ctx.method === 'GET') {
      return { status: 200, body: host.comments.map((c) => commentJson(repo, c)) };
    }
    return notFound();
  }
  return notFound();
}

function routePulls(repo: RepoRec, tail: string[], ctx: Ctx): Reply {
  if (tail.length === 0) {
    if (ctx.method === 'POST') {
      if (ctx.jsonError) return badJson();
      const body = bodyObject(ctx);
      const title = str(body.title);
      const head = str(body.head);
      const base = str(body.base);
      if (title === undefined || head === undefined || base === undefined) {
        return unprocessable('Validation Failed: title, head and base are required');
      }
      const created = createPull(repo, { title, body: str(body.body) ?? '', head, base });
      if ('error' in created) return unprocessable(created.error);
      return { status: 201, body: pullJson(repo, created) };
    }
    if (ctx.method === 'GET') {
      const state = ctx.query.get('state') ?? 'open';
      let pulls = [...repo.pulls.values()];
      if (state === 'open') pulls = pulls.filter((p) => p.state === 'open');
      else if (state === 'closed') pulls = pulls.filter((p) => p.state === 'closed');
      pulls.sort((a, b) => b.number - a.number);
      const { page, perPage } = pagination(ctx);
      const slice = pulls.slice((page - 1) * perPage, page * perPage);
      return { status: 200, body: slice.map((p) => pullJson(repo, p)) };
    }
    return notFound();
  }
  const number = parseInt(tail[0], 10);
  const pull = Number.isInteger(number) ? repo.pulls.get(number) : undefined;
  if (tail.length === 1 && ctx.method === 'GET') {
    if (pull === undefined) return notFound();
    return { status: 200, body: pullJson(repo, pull) };
  }
  if (tail.length === 2 && tail[1] === 'files' && ctx.method === 'GET') {
    if (pull === undefined) return notFound();
    const files = pullFiles(repo, pull).map((f) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      changes: f.changes,
      sha: '',
      blob_url: '',
      raw_url: '',
      contents_url: '',
    }));
    return { status: 200, body: files };
  }
  if (tail.length === 2 && tail[1] === 'merge' && ctx.method === 'PUT') {
    if (pull === undefined) return notFound();
    if (ctx.jsonError) return badJson();
    const body = bodyObject(ctx);
    const method = str(body.merge_method) === 'merge' ? 'merge' : 'squash';
    const result = mergePull(repo, pull, method);
    if (!result.ok) {
      return { status: 405, body: { message: 'Pull Request is not mergeable', documentation_url: '' } };
    }
    return { status: 200, body: { sha: result.sha, merged: true, message: 'Pull Request successfully merged' } };
  }
  return notFound();
}

