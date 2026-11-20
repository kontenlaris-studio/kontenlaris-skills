// GraphQL v4 surface at /api/graphql: a small hand-written lexer, parser and executor
// covering exactly the document shapes gh and github-mcp-server send (named operations,
// variables with input objects and enum lists, aliases, inline fragments), plus the
// introspection surface the conformance suite pins down. GraphQL-level failures are
// 200s with an `errors` array; only transport/auth failures are HTTP errors.

import { forge, VIEWER, type IssueRec, type PullRec, type RepoRec } from './store.ts';
import { commentGid, issueGid, parseGid, parseRepoNumberKey, pullGid, repoGid, userGid } from './ids.ts';
import { createIssue, createPull } from './rest.ts';
import { mergePull, pullFiles, pullMergeable } from './repops.ts';

// ---------------------------------------------------------------------------
// Lexer

interface Token {
  kind: 'name' | 'int' | 'float' | 'string' | 'punct' | 'spread' | 'eof';
  value: string;
}

function lex(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === ',' || ch === '\uFEFF') {
      i += 1;
      continue;
    }
    if (ch === '#') {
      while (i < input.length && input[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '.' && input.startsWith('...', i)) {
      tokens.push({ kind: 'spread', value: '...' });
      i += 3;
      continue;
    }
    if ('!$():=@[]{}|&'.includes(ch)) {
      tokens.push({ kind: 'punct', value: ch });
      i += 1;
      continue;
    }
    if (ch === '"') {
      if (input.startsWith('"""', i)) {
        const end = input.indexOf('"""', i + 3);
        const raw = end === -1 ? input.slice(i + 3) : input.slice(i + 3, end);
        tokens.push({ kind: 'string', value: raw });
        i = end === -1 ? input.length : end + 3;
        continue;
      }
      let j = i + 1;
      let value = '';
      while (j < input.length && input[j] !== '"') {
        if (input[j] === '\\' && j + 1 < input.length) {
          const esc = input[j + 1];
          if (esc === 'n') value += '\n';
          else if (esc === 't') value += '\t';
          else if (esc === 'r') value += '\r';
          else if (esc === 'b') value += '\b';
          else if (esc === 'f') value += '\f';
          else if (esc === 'u') {
            value += String.fromCharCode(parseInt(input.slice(j + 2, j + 6), 16));
            j += 4;
          } else value += esc;
          j += 2;
        } else {
          value += input[j];
          j += 1;
        }
      }
      tokens.push({ kind: 'string', value });
      i = j + 1;
      continue;
    }
    if (/[0-9-]/.test(ch)) {
      let j = i;
      if (input[j] === '-') j += 1;
      while (j < input.length && /[0-9]/.test(input[j])) j += 1;
      let isFloat = false;
      if (input[j] === '.') {
        isFloat = true;
        j += 1;
        while (j < input.length && /[0-9]/.test(input[j])) j += 1;
      }
      if (input[j] === 'e' || input[j] === 'E') {
        isFloat = true;
        j += 1;
        if (input[j] === '+' || input[j] === '-') j += 1;
        while (j < input.length && /[0-9]/.test(input[j])) j += 1;
      }
      tokens.push({ kind: isFloat ? 'float' : 'int', value: input.slice(i, j) });
      i = j;
      continue;
    }
    if (/[_A-Za-z]/.test(ch)) {
      let j = i;
      while (j < input.length && /[_0-9A-Za-z]/.test(input[j])) j += 1;
      tokens.push({ kind: 'name', value: input.slice(i, j) });
      i = j;
      continue;
    }
    throw new Error(`unexpected character ${JSON.stringify(ch)}`);
  }
  tokens.push({ kind: 'eof', value: '' });
  return tokens;
}

// ---------------------------------------------------------------------------
// Parser

type ValueNode =
  | { kind: 'var'; name: string }
  | { kind: 'int'; value: number }
  | { kind: 'float'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'bool'; value: boolean }
  | { kind: 'null' }
  | { kind: 'enum'; value: string }
  | { kind: 'list'; items: ValueNode[] }
  | { kind: 'object'; fields: { name: string; value: ValueNode }[] };

interface FieldNode {
  alias: string | null;
  name: string;
  args: Map<string, ValueNode>;
  selection: SelectionNode[] | null;
}

type SelectionNode =
  | { kind: 'field'; field: FieldNode }
  | { kind: 'inline'; typeCondition: string | null; selection: SelectionNode[] }
  | { kind: 'spread'; name: string };

interface OperationNode {
  type: 'query' | 'mutation';
  name: string | null;
  selection: SelectionNode[];
}

interface FragmentNode {
  name: string;
  typeCondition: string;
  selection: SelectionNode[];
}

class Parser {
  private pos = 0;
  private readonly tokens: Token[];
  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.pos];
  }
  private next(): Token {
    const token = this.tokens[this.pos];
    this.pos += 1;
    return token;
  }
  private expectPunct(value: string): void {
    const token = this.next();
    if (token.kind !== 'punct' || token.value !== value) throw new Error(`expected "${value}", got ${token.value}`);
  }
  private skipBalanced(open: string, close: string): void {
    this.expectPunct(open);
    let depth = 1;
    while (depth > 0) {
      const token = this.next();
      if (token.kind === 'eof') throw new Error('unbalanced delimiters');
      if (token.kind === 'punct' && token.value === open) depth += 1;
      else if (token.kind === 'punct' && token.value === close) depth -= 1;
    }
  }
  private skipDirectives(): void {
    while (this.peek().kind === 'punct' && this.peek().value === '@') {
      this.next();
      this.next(); // directive name
      if (this.peek().kind === 'punct' && this.peek().value === '(') this.skipBalanced('(', ')');
    }
  }

  parseDocument(): { operations: OperationNode[]; fragments: Map<string, FragmentNode> } {
    const operations: OperationNode[] = [];
    const fragments = new Map<string, FragmentNode>();
    while (this.peek().kind !== 'eof') {
      const token = this.peek();
      if (token.kind === 'punct' && token.value === '{') {
        operations.push({ type: 'query', name: null, selection: this.parseSelectionSet() });
      } else if (token.kind === 'name' && (token.value === 'query' || token.value === 'mutation' || token.value === 'subscription')) {
        this.next();
        let name: string | null = null;
        if (this.peek().kind === 'name') name = this.next().value;
        if (this.peek().kind === 'punct' && this.peek().value === '(') this.skipBalanced('(', ')');
        this.skipDirectives();
        operations.push({ type: token.value === 'mutation' ? 'mutation' : 'query', name, selection: this.parseSelectionSet() });
      } else if (token.kind === 'name' && token.value === 'fragment') {
        this.next();
        const name = this.next().value;
        this.next(); // 'on'
        const typeCondition = this.next().value;
        this.skipDirectives();
        fragments.set(name, { name, typeCondition, selection: this.parseSelectionSet() });
      } else {
        throw new Error(`unexpected token ${token.value}`);
      }
    }
    return { operations, fragments };
  }

  private parseSelectionSet(): SelectionNode[] {
    this.expectPunct('{');
    const selections: SelectionNode[] = [];
    while (!(this.peek().kind === 'punct' && this.peek().value === '}')) {
      if (this.peek().kind === 'eof') throw new Error('unterminated selection set');
      selections.push(this.parseSelection());
    }
    this.next();
    return selections;
  }

  private parseSelection(): SelectionNode {
    const token = this.peek();
    if (token.kind === 'spread') {
      this.next();
      if (this.peek().kind === 'name' && this.peek().value === 'on') {
        this.next();
        const typeCondition = this.next().value;
        this.skipDirectives();
        return { kind: 'inline', typeCondition, selection: this.parseSelectionSet() };
      }
      const name = this.next().value;
      this.skipDirectives();
      return { kind: 'spread', name };
    }
    let name = this.next().value;
    let alias: string | null = null;
    if (this.peek().kind === 'punct' && this.peek().value === ':') {
      this.next();
      alias = name;
      name = this.next().value;
    }
    const args = new Map<string, ValueNode>();
    if (this.peek().kind === 'punct' && this.peek().value === '(') {
      this.next();
      while (!(this.peek().kind === 'punct' && this.peek().value === ')')) {
        const argName = this.next().value;
        this.expectPunct(':');
        args.set(argName, this.parseValue());
      }
      this.next();
    }
    this.skipDirectives();
    let selection: SelectionNode[] | null = null;
    if (this.peek().kind === 'punct' && this.peek().value === '{') selection = this.parseSelectionSet();
    return { kind: 'field', field: { alias, name, args, selection } };
  }

  private parseValue(): ValueNode {
    const token = this.next();
    if (token.kind === 'punct' && token.value === '$') return { kind: 'var', name: this.next().value };
    if (token.kind === 'int') return { kind: 'int', value: parseInt(token.value, 10) };
    if (token.kind === 'float') return { kind: 'float', value: parseFloat(token.value) };
    if (token.kind === 'string') return { kind: 'string', value: token.value };
    if (token.kind === 'punct' && token.value === '[') {
      const items: ValueNode[] = [];
      while (!(this.peek().kind === 'punct' && this.peek().value === ']')) items.push(this.parseValue());
      this.next();
      return { kind: 'list', items };
    }
    if (token.kind === 'punct' && token.value === '{') {
      const fields: { name: string; value: ValueNode }[] = [];
      while (!(this.peek().kind === 'punct' && this.peek().value === '}')) {
        const name = this.next().value;
        this.expectPunct(':');
        fields.push({ name, value: this.parseValue() });
      }
      this.next();
      return { kind: 'object', fields };
    }
    if (token.kind === 'name') {
      if (token.value === 'true') return { kind: 'bool', value: true };
      if (token.value === 'false') return { kind: 'bool', value: false };
      if (token.value === 'null') return { kind: 'null' };
      return { kind: 'enum', value: token.value };
    }
    throw new Error(`unexpected value token ${token.value}`);
  }
}

function valueOf(node: ValueNode, vars: Record<string, unknown>): unknown {
  switch (node.kind) {
    case 'var': return vars[node.name];
    case 'int': case 'float': case 'string': case 'bool': case 'enum': return node.value;
    case 'null': return null;
    case 'list': return node.items.map((item) => valueOf(item, vars));
    case 'object': {
      const out: Record<string, unknown> = {};
      for (const field of node.fields) out[field.name] = valueOf(field.value, vars);
      return out;
    }
  }
}

// ---------------------------------------------------------------------------
// Executor

interface Wrapped {
  __type: string;
  data: Record<string, unknown>;
}

function obj(type: string, data: Record<string, unknown>): Wrapped {
  return { __type: type, data };
}

function isWrapped(value: unknown): value is Wrapped {
  return value !== null && typeof value === 'object' && '__type' in (value as Record<string, unknown>);
}

interface ExecError {
  message: string;
}

interface ExecCtx {
  vars: Record<string, unknown>;
  fragments: Map<string, FragmentNode>;
  errors: ExecError[];
}

type Resolver = (source: Wrapped, args: Record<string, unknown>, ctx: ExecCtx) => unknown;

const SCHEMA: Record<string, Record<string, Resolver>> = {};

function def(type: string, fields: Record<string, Resolver>): void {
  SCHEMA[type] = fields;
}

const get = (key: string): Resolver => (source) => source.data[key];

function executeSelection(source: Wrapped, selections: SelectionNode[], ctx: ExecCtx): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const expanded: FieldNode[] = [];
  const expand = (sels: SelectionNode[], seen: Set<string>): void => {
    for (const sel of sels) {
      if (sel.kind === 'field') expanded.push(sel.field);
      else if (sel.kind === 'inline') {
        if (sel.typeCondition === null || sel.typeCondition === source.__type) expand(sel.selection, seen);
      } else if (sel.kind === 'spread') {
        if (seen.has(sel.name)) continue;
        seen.add(sel.name);
        const fragment = ctx.fragments.get(sel.name);
        if (fragment !== undefined && fragment.typeCondition === source.__type) expand(fragment.selection, seen);
      }
    }
  };
  expand(selections, new Set());
  for (const field of expanded) {
    const key = field.alias ?? field.name;
    out[key] = resolveField(source, field, ctx);
  }
  return out;
}

function resolveField(source: Wrapped, field: FieldNode, ctx: ExecCtx): unknown {
  if (field.name === '__typename') return source.__type;
  const args: Record<string, unknown> = {};
  for (const [name, node] of field.args) {
    const value = valueOf(node, ctx.vars);
    if (value !== undefined) args[name] = value;
  }
  const typeFields = SCHEMA[source.__type];
  let value: unknown;
  if (typeFields !== undefined) {
    const resolver = typeFields[field.name];
    if (resolver === undefined) {
      ctx.errors.push({ message: `Field "${field.name}" is not defined by type "${source.__type}".` });
      return null;
    }
    try {
      value = resolver(source, args, ctx);
    } catch (err) {
      ctx.errors.push({ message: err instanceof Error ? err.message : String(err) });
      return null;
    }
  } else if (field.name in source.data) {
    value = source.data[field.name];
  } else {
    ctx.errors.push({ message: `Field "${field.name}" is not defined by type "${source.__type}".` });
    return null;
  }
  return complete(value, field.selection, ctx);
}

function complete(value: unknown, selection: SelectionNode[] | null, ctx: ExecCtx): unknown {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map((item) => complete(item, selection, ctx));
  if (isWrapped(value)) {
    if (selection === null) return value.data;
    return executeSelection(value, selection, ctx);
  }
  if (typeof value === 'object') {
    if (selection === null) return value;
    return executeSelection(obj('__PlainObject', value as Record<string, unknown>), selection, ctx);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Introspection data

const TYPE_DEFS: Record<string, { kind: string; fields?: string[]; enumValues?: string[] }> = {
  Query: { kind: 'OBJECT', fields: ['viewer', 'repository', 'node', 'rateLimit', 'meta'] },
  Mutation: { kind: 'OBJECT', fields: ['createIssue', 'closeIssue', 'createPullRequest', 'mergePullRequest', 'addComment'] },
  User: { kind: 'OBJECT', fields: ['id', 'login', 'name', 'email', 'url', 'createdAt', 'updatedAt'] },
  RepositoryOwner: { kind: 'INTERFACE', fields: ['id', 'login', 'url'] },
  Repository: {
    kind: 'OBJECT',
    fields: ['id', 'databaseId', 'name', 'nameWithOwner', 'owner', 'description', 'isPrivate', 'isFork', 'isArchived', 'createdAt', 'updatedAt', 'pushedAt', 'url', 'defaultBranchRef', 'viewerPermission', 'hasIssuesEnabled', 'hasProjectsEnabled', 'hasWikiEnabled', 'issue', 'issues', 'pullRequest', 'pullRequests', 'stargazerCount', 'forkCount', 'primaryLanguage'],
  },
  Issue: {
    kind: 'OBJECT',
    fields: ['id', 'number', 'title', 'state', 'body', 'url', 'createdAt', 'updatedAt', 'closedAt', 'author', 'repository', 'comments', 'labels'],
  },
  PullRequest: {
    kind: 'OBJECT',
    fields: ['id', 'number', 'title', 'body', 'state', 'merged', 'mergeable', 'headRefName', 'baseRefName', 'headRef', 'baseRef', 'files', 'createdAt', 'updatedAt', 'closedAt', 'mergedAt', 'additions', 'deletions', 'changedFiles', 'author', 'repository', 'commits', 'comments', 'reviews', 'url', 'mergeCommit'],
  },
  SearchType: { kind: 'ENUM', enumValues: ['ISSUE', 'REPOSITORY', 'USER', 'DISCUSSION'] },
  IssueState: { kind: 'ENUM', enumValues: ['OPEN', 'CLOSED'] },
  PullRequestState: { kind: 'ENUM', enumValues: ['OPEN', 'CLOSED', 'MERGED'] },
  MergeableState: { kind: 'ENUM', enumValues: ['MERGEABLE', 'CONFLICTING', 'UNKNOWN'] },
  PageInfo: { kind: 'OBJECT', fields: ['hasNextPage', 'hasPreviousPage', 'startCursor', 'endCursor'] },
  IssueConnection: { kind: 'OBJECT', fields: ['nodes', 'edges', 'pageInfo', 'totalCount'] },
  IssueEdge: { kind: 'OBJECT', fields: ['node', 'cursor'] },
  PullRequestConnection: { kind: 'OBJECT', fields: ['nodes', 'edges', 'pageInfo', 'totalCount'] },
  PullRequestEdge: { kind: 'OBJECT', fields: ['node', 'cursor'] },
  PullRequestChangedFile: { kind: 'OBJECT', fields: ['path', 'additions', 'deletions', 'changeType'] },
  Ref: { kind: 'OBJECT', fields: ['id', 'name', 'prefix', 'target'] },
  IssueComment: { kind: 'OBJECT', fields: ['id', 'body', 'author', 'createdAt', 'updatedAt', 'url'] },
  Label: { kind: 'OBJECT', fields: ['id', 'name', 'color', 'description'] },
  PullRequestMergeMethod: { kind: 'ENUM', enumValues: ['MERGE', 'SQUASH', 'REBASE'] },
  OrderDirection: { kind: 'ENUM', enumValues: ['ASC', 'DESC'] },
  IssueOrderField: { kind: 'ENUM', enumValues: ['CREATED_AT', 'UPDATED_AT', 'COMMENTS'] },
};

function typeWrapper(name: string): Wrapped | null {
  const def = TYPE_DEFS[name];
  if (def === undefined) return null;
  return obj('__Type', {
    name,
    kind: def.kind,
    fields: (def.fields ?? []).map((fieldName) => obj('__Field', { name: fieldName })),
    enumValues: (def.enumValues ?? []).map((valueName) => obj('__EnumValue', { name: valueName })),
  });
}

def('__Type', {
  name: get('name'),
  kind: get('kind'),
  description: () => null,
  fields: get('fields'),
  enumValues: get('enumValues'),
  possibleTypes: () => null,
  inputFields: () => null,
  ofType: () => null,
});
def('__Field', { name: get('name'), description: () => null, args: () => [], isDeprecated: () => false, deprecationReason: () => null });
def('__EnumValue', { name: get('name'), description: () => null, isDeprecated: () => false, deprecationReason: () => null });
def('__Schema', {
  queryType: () => typeWrapper('Query'),
  mutationType: () => typeWrapper('Mutation'),
  subscriptionType: () => null,
  types: () => Object.keys(TYPE_DEFS).map((name) => typeWrapper(name)),
  directives: () => [],
});

// ---------------------------------------------------------------------------
// Domain wrappers

function userWrapper(login: string): Wrapped {
  return obj('User', { login });
}

function repoWrapper(repo: RepoRec): Wrapped {
  return obj('Repository', { repo });
}

function issueWrapper(repo: RepoRec, issue: IssueRec): Wrapped {
  return obj('Issue', { repo, issue });
}

function pullWrapper(repo: RepoRec, pull: PullRec): Wrapped {
  return obj('PullRequest', { repo, pull });
}

function commentWrapper(comment: { id: number; body: string; createdAt: string; updatedAt: string }): Wrapped {
  return obj('IssueComment', { comment });
}

function cursorOf(number: number): string {
  return Buffer.from(`cursor:${number}`, 'utf8').toString('base64');
}

function cursorNumber(cursor: unknown): number | null {
  if (typeof cursor !== 'string') return null;
  try {
    const text = Buffer.from(cursor, 'base64').toString('utf8');
    const match = /^cursor:(\d+)$/.exec(text);
    return match === null ? null : parseInt(match[1], 10);
  } catch {
    return null;
  }
}

interface ConnectionSpec {
  type: string;
  items: Wrapped[];
  numbers: number[];
  first: number;
  after: unknown;
  descending: boolean;
}

function connection(spec: ConnectionSpec): Wrapped {
  let startIndex = 0;
  const afterNumber = cursorNumber(spec.after);
  if (afterNumber !== null) {
    const idx = spec.numbers.findIndex((n) => (spec.descending ? n < afterNumber : n > afterNumber));
    startIndex = idx === -1 ? spec.numbers.length : idx;
  }
  const remaining = spec.items.slice(startIndex);
  const page = remaining.slice(0, Math.max(0, spec.first));
  const hasNextPage = remaining.length > page.length;
  const endCursor = page.length > 0 ? cursorOf(spec.numbers[startIndex + page.length - 1]) : null;
  return obj(spec.type, {
    nodes: page,
    edges: page.map((node, i) => obj('__Edge', { node, cursor: cursorOf(spec.numbers[startIndex + i]) })),
    pageInfo: obj('PageInfo', {
      hasNextPage,
      hasPreviousPage: startIndex > 0,
      startCursor: page.length > 0 ? cursorOf(spec.numbers[startIndex]) : null,
      endCursor,
    }),
    totalCount: spec.items.length,
  });
}

def('PageInfo', {
  hasNextPage: get('hasNextPage'),
  hasPreviousPage: get('hasPreviousPage'),
  startCursor: get('startCursor'),
  endCursor: get('endCursor'),
});
def('__Edge', { node: get('node'), cursor: get('cursor') });

function defConnection(type: string): void {
  def(type, { nodes: get('nodes'), edges: get('edges'), pageInfo: get('pageInfo'), totalCount: get('totalCount') });
}
defConnection('IssueConnection');
defConnection('PullRequestConnection');
defConnection('PullRequestChangedFileConnection');
defConnection('IssueCommentConnection');
defConnection('LabelConnection');
defConnection('CommitConnection');
defConnection('PullRequestReviewConnection');

def('User', {
  id: () => userGid(VIEWER.login),
  login: get('login'),
  name: () => VIEWER.name,
  email: () => VIEWER.email,
  url: () => '',
  createdAt: () => '2025-01-01T00:00:00.000Z',
  updatedAt: () => '2025-01-01T00:00:00.000Z',
});

def('Repository', {
  id: (s) => repoGid((s.data.repo as RepoRec).dbId),
  databaseId: (s) => (s.data.repo as RepoRec).dbId,
  name: (s) => (s.data.repo as RepoRec).name,
  nameWithOwner: (s) => `${(s.data.repo as RepoRec).owner}/${(s.data.repo as RepoRec).name}`,
  owner: (s) => userWrapper((s.data.repo as RepoRec).owner),
  description: (s) => (s.data.repo as RepoRec).description,
  isPrivate: (s) => (s.data.repo as RepoRec).isPrivate,
  isFork: () => false,
  isArchived: () => false,
  createdAt: (s) => (s.data.repo as RepoRec).createdAt,
  updatedAt: (s) => (s.data.repo as RepoRec).updatedAt,
  pushedAt: (s) => (s.data.repo as RepoRec).updatedAt,
  url: () => '',
  defaultBranchRef: (s) => {
    const repo = s.data.repo as RepoRec;
    const exists = repo.refs.has(`refs/heads/${repo.defaultBranch}`);
    return exists ? obj('Ref', { name: repo.defaultBranch }) : null;
  },
  viewerPermission: () => 'ADMIN',
  hasIssuesEnabled: () => true,
  hasProjectsEnabled: () => true,
  hasWikiEnabled: () => true,
  stargazerCount: () => 0,
  forkCount: () => 0,
  primaryLanguage: () => null,
  issue: (s, args) => {
    const repo = s.data.repo as RepoRec;
    const issue = repo.issues.get(Number(args.number));
    return issue === undefined ? null : issueWrapper(repo, issue);
  },
  issues: (s, args) => {
    const repo = s.data.repo as RepoRec;
    let issues = [...repo.issues.values()];
    const states = Array.isArray(args.states) ? (args.states as string[]) : null;
    if (states !== null) issues = issues.filter((i) => states.includes(i.state.toUpperCase()));
    const orderBy = (args.orderBy ?? {}) as { field?: string; direction?: string };
    const descending = orderBy.direction === 'DESC';
    issues.sort((a, b) => (descending ? b.number - a.number : a.number - b.number));
    return connection({
      type: 'IssueConnection',
      items: issues.map((i) => issueWrapper(repo, i)),
      numbers: issues.map((i) => i.number),
      first: typeof args.first === 'number' ? args.first : 100,
      after: args.after,
      descending,
    });
  },
  pullRequest: (s, args) => {
    const repo = s.data.repo as RepoRec;
    const pull = repo.pulls.get(Number(args.number));
    return pull === undefined ? null : pullWrapper(repo, pull);
  },
  pullRequests: (s, args) => {
    const repo = s.data.repo as RepoRec;
    let pulls = [...repo.pulls.values()];
    const states = Array.isArray(args.states) ? (args.states as string[]) : null;
    if (states !== null) {
      pulls = pulls.filter((p) => states.includes(p.merged ? 'MERGED' : p.state.toUpperCase()));
    }
    const orderBy = (args.orderBy ?? {}) as { direction?: string };
    const descending = orderBy.direction !== 'ASC';
    pulls.sort((a, b) => (descending ? b.number - a.number : a.number - b.number));
    return connection({
      type: 'PullRequestConnection',
      items: pulls.map((p) => pullWrapper(repo, p)),
      numbers: pulls.map((p) => p.number),
      first: typeof args.first === 'number' ? args.first : 100,
      after: args.after,
      descending,
    });
  },
});

def('Ref', {
  id: (s) => Buffer.from(`Ref:${s.data.name as string}`, 'utf8').toString('base64'),
  name: get('name'),
  prefix: () => 'refs/heads/',
  target: () => null,
});

def('Issue', {
  id: (s) => issueGid((s.data.repo as RepoRec).dbId, (s.data.issue as IssueRec).number),
  number: (s) => (s.data.issue as IssueRec).number,
  title: (s) => (s.data.issue as IssueRec).title,
  state: (s) => (s.data.issue as IssueRec).state.toUpperCase(),
  body: (s) => (s.data.issue as IssueRec).body,
  url: () => '',
  createdAt: (s) => (s.data.issue as IssueRec).createdAt,
  updatedAt: (s) => (s.data.issue as IssueRec).updatedAt,
  closedAt: (s) => (s.data.issue as IssueRec).closedAt,
  author: () => userWrapper(VIEWER.login),
  repository: (s) => repoWrapper(s.data.repo as RepoRec),
  comments: (s, args) => {
    const issue = s.data.issue as IssueRec;
    return connection({
      type: 'IssueCommentConnection',
      items: issue.comments.map((c) => commentWrapper(c)),
      numbers: issue.comments.map((c) => c.id),
      first: typeof args.first === 'number' ? args.first : 100,
      after: args.after,
      descending: false,
    });
  },
  labels: (s, args) => {
    const repo = s.data.repo as RepoRec;
    const issue = s.data.issue as IssueRec;
    void args;
    return obj('LabelConnection', {
      nodes: issue.labels.map((name) => obj('Label', { name, color: repo.labels.get(name)?.color ?? 'ededed' })),
      edges: [],
      pageInfo: obj('PageInfo', { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null }),
      totalCount: issue.labels.length,
    });
  },
});

def('Label', {
  id: (s) => Buffer.from(`Label:${s.data.name as string}`, 'utf8').toString('base64'),
  name: get('name'),
  color: get('color'),
  description: () => null,
});

def('IssueComment', {
  id: (s) => commentGid((s.data.comment as { id: number }).id),
  body: (s) => (s.data.comment as { body: string }).body,
  author: () => userWrapper(VIEWER.login),
  createdAt: (s) => (s.data.comment as { createdAt: string }).createdAt,
  updatedAt: (s) => (s.data.comment as { updatedAt: string }).updatedAt,
  url: () => '',
});

def('PullRequestChangedFile', {
  path: get('path'),
  additions: get('additions'),
  deletions: get('deletions'),
  changeType: get('changeType'),
});

def('PullRequest', {
  id: (s) => pullGid((s.data.repo as RepoRec).dbId, (s.data.pull as PullRec).number),
  number: (s) => (s.data.pull as PullRec).number,
  title: (s) => (s.data.pull as PullRec).title,
  body: (s) => (s.data.pull as PullRec).body,
  state: (s) => {
    const pull = s.data.pull as PullRec;
    return pull.merged ? 'MERGED' : pull.state.toUpperCase();
  },
  merged: (s) => (s.data.pull as PullRec).merged,
  mergeable: (s) => {
    const pull = s.data.pull as PullRec;
    if (pull.merged) return 'UNKNOWN';
    return pullMergeable(s.data.repo as RepoRec, pull) ? 'MERGEABLE' : 'CONFLICTING';
  },
  headRefName: (s) => (s.data.pull as PullRec).headRef,
  baseRefName: (s) => (s.data.pull as PullRec).baseRef,
  headRef: (s) => obj('Ref', { name: (s.data.pull as PullRec).headRef }),
  baseRef: (s) => obj('Ref', { name: (s.data.pull as PullRec).baseRef }),
  files: (s, args) => {
    const repo = s.data.repo as RepoRec;
    const pull = s.data.pull as PullRec;
    const files = pullFiles(repo, pull);
    return connection({
      type: 'PullRequestChangedFileConnection',
      items: files.map((f) => obj('PullRequestChangedFile', {
        path: f.filename,
        additions: f.additions,
        deletions: f.deletions,
        changeType: f.status === 'added' ? 'ADDED' : f.status === 'removed' ? 'DELETED' : 'MODIFIED',
      })),
      numbers: files.map((_, i) => i + 1),
      first: typeof args.first === 'number' ? args.first : 100,
      after: args.after,
      descending: false,
    });
  },
  createdAt: (s) => (s.data.pull as PullRec).createdAt,
  updatedAt: (s) => (s.data.pull as PullRec).updatedAt,
  closedAt: (s) => (s.data.pull as PullRec).closedAt,
  mergedAt: (s) => (s.data.pull as PullRec).mergedAt,
  additions: (s) => pullFiles(s.data.repo as RepoRec, s.data.pull as PullRec).reduce((n, f) => n + f.additions, 0),
  deletions: (s) => pullFiles(s.data.repo as RepoRec, s.data.pull as PullRec).reduce((n, f) => n + f.deletions, 0),
  changedFiles: (s) => pullFiles(s.data.repo as RepoRec, s.data.pull as PullRec).length,
  author: () => userWrapper(VIEWER.login),
  repository: (s) => repoWrapper(s.data.repo as RepoRec),
  commits: (s, args) => connection({
    type: 'CommitConnection',
    items: [],
    numbers: [],
    first: typeof args.first === 'number' ? args.first : 100,
    after: args.after,
    descending: false,
  }),
  comments: (s, args) => {
    const pull = s.data.pull as PullRec;
    return connection({
      type: 'IssueCommentConnection',
      items: pull.comments.map((c) => commentWrapper(c)),
      numbers: pull.comments.map((c) => c.id),
      first: typeof args.first === 'number' ? args.first : 100,
      after: args.after,
      descending: false,
    });
  },
  reviews: (s, args) => connection({
    type: 'PullRequestReviewConnection',
    items: [],
    numbers: [],
    first: typeof args.first === 'number' ? args.first : 100,
    after: args.after,
    descending: false,
  }),
  url: () => '',
  mergeCommit: () => null,
});

function repoByDbId(dbId: number): RepoRec | undefined {
  for (const repo of forge.repos.values()) if (repo.dbId === dbId) return repo;
  return undefined;
}

function nodeById(id: unknown): Wrapped | null {
  if (typeof id !== 'string') return null;
  const parsed = parseGid(id);
  if (parsed === null) return null;
  if (parsed.kind === 'Repository') {
    const repo = repoByDbId(Number(parsed.key));
    return repo === undefined ? null : repoWrapper(repo);
  }
  if (parsed.kind === 'Issue' || parsed.kind === 'PullRequest') {
    const key = parseRepoNumberKey(parsed.key);
    if (key === null) return null;
    const repo = repoByDbId(key.repoDbId);
    if (repo === undefined) return null;
    if (parsed.kind === 'Issue') {
      const issue = repo.issues.get(key.number);
      return issue === undefined ? null : issueWrapper(repo, issue);
    }
    const pull = repo.pulls.get(key.number);
    return pull === undefined ? null : pullWrapper(repo, pull);
  }
  if (parsed.kind === 'User') {
    return parsed.key === VIEWER.login ? userWrapper(VIEWER.login) : null;
  }
  if (parsed.kind === 'IssueComment') {
    const commentId = Number(parsed.key);
    for (const repo of forge.repos.values()) {
      for (const host of [...repo.issues.values(), ...repo.pulls.values()]) {
        const comment = host.comments.find((c) => c.id === commentId);
        if (comment !== undefined) return commentWrapper(comment);
      }
    }
    return null;
  }
  return null;
}

def('Query', {
  viewer: () => userWrapper(VIEWER.login),
  repository: (_s, args) => {
    const repo = forge.getRepo(String(args.owner ?? ''), String(args.name ?? ''));
    return repo === undefined ? null : repoWrapper(repo);
  },
  node: (_s, args) => nodeById(args.id),
  __type: (_s, args) => typeWrapper(String(args.name ?? '')),
  __schema: () => obj('__Schema', {}),
  rateLimit: () => obj('__PlainObject', { limit: 5000, cost: 1, remaining: 4999, resetAt: '2025-01-01T01:00:00.000Z' }),
  meta: () => obj('__PlainObject', {}),
});

function inputOf(args: Record<string, unknown>): Record<string, unknown> {
  const input = args.input;
  return input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : args;
}

def('Mutation', {
  createIssue: (_s, args) => {
    const input = inputOf(args);
    const parsed = typeof input.repositoryId === 'string' ? parseGid(input.repositoryId) : null;
    const repo = parsed !== null && parsed.kind === 'Repository' ? repoByDbId(Number(parsed.key)) : undefined;
    if (repo === undefined) throw new Error('Repository not found');
    const created = createIssue(repo, {
      title: String(input.title ?? ''),
      body: typeof input.body === 'string' ? input.body : '',
      labels: [],
    });
    if ('error' in created) throw new Error(created.error);
    return obj('CreateIssuePayload', { issue: issueWrapper(repo, created) });
  },
  closeIssue: (_s, args) => {
    const input = inputOf(args);
    const node = nodeById(input.issueId);
    if (node === null || node.__type !== 'Issue') throw new Error('Issue not found');
    const repo = node.data.repo as RepoRec;
    const issue = node.data.issue as IssueRec;
    issue.state = 'closed';
    issue.closedAt = forge.nowIso();
    issue.updatedAt = issue.closedAt;
    void repo;
    return obj('CloseIssuePayload', { issue: node });
  },
  createPullRequest: (_s, args) => {
    const input = inputOf(args);
    const parsed = typeof input.repositoryId === 'string' ? parseGid(input.repositoryId) : null;
    const repo = parsed !== null && parsed.kind === 'Repository' ? repoByDbId(Number(parsed.key)) : undefined;
    if (repo === undefined) throw new Error('Repository not found');
    const created = createPull(repo, {
      title: String(input.title ?? ''),
      body: typeof input.body === 'string' ? input.body : '',
      head: String(input.headRefName ?? ''),
      base: String(input.baseRefName ?? ''),
    });
    if ('error' in created) throw new Error(created.error);
    return obj('CreatePullRequestPayload', { pullRequest: pullWrapper(repo, created) });
  },
  mergePullRequest: (_s, args) => {
    const input = inputOf(args);
    const node = nodeById(input.pullRequestId);
    if (node === null || node.__type !== 'PullRequest') throw new Error('Pull request not found');
    const repo = node.data.repo as RepoRec;
    const pull = node.data.pull as PullRec;
    const method = input.mergeMethod === 'MERGE' ? 'merge' : 'squash';
    const result = mergePull(repo, pull, method);
    if (!result.ok) throw new Error('Pull Request is not mergeable');
    return obj('MergePullRequestPayload', { pullRequest: node });
  },
  addComment: (_s, args) => {
    const input = inputOf(args);
    const node = nodeById(input.subjectId);
    if (node === null || (node.__type !== 'Issue' && node.__type !== 'PullRequest')) throw new Error('Subject not found');
    const host = (node.__type === 'Issue' ? node.data.issue : node.data.pull) as IssueRec | PullRec;
    const ts = forge.nowIso();
    const comment = { id: forge.allocCommentId(), body: String(input.body ?? ''), createdAt: ts, updatedAt: ts };
    host.comments.push(comment);
    return obj('AddCommentPayload', {
      commentEdge: obj('__Edge', { node: commentWrapper(comment), cursor: cursorOf(comment.id) }),
    });
  },
});

// ---------------------------------------------------------------------------
// Entry point

export interface GraphQLResult {
  data?: Record<string, unknown> | null;
  errors?: { message: string }[];
}

export function executeGraphQL(body: unknown): GraphQLResult | GraphQLResult[] {
  if (Array.isArray(body)) {
    return body.map((operation) => executeOne(operation) as GraphQLResult);
  }
  return executeOne(body);
}

function executeOne(operation: unknown): GraphQLResult {
  if (operation === null || typeof operation !== 'object') {
    return { errors: [{ message: 'Invalid operation' }] };
  }
  const { query, variables, operationName } = operation as { query?: unknown; variables?: unknown; operationName?: unknown };
  if (typeof query !== 'string') return { errors: [{ message: 'Query must be a string' }] };
  let document: { operations: OperationNode[]; fragments: Map<string, FragmentNode> };
  try {
    document = new Parser(lex(query)).parseDocument();
  } catch (err) {
    return { errors: [{ message: err instanceof Error ? err.message : 'Parse error' }] };
  }
  const vars = variables !== null && typeof variables === 'object' ? (variables as Record<string, unknown>) : {};
  let op: OperationNode | undefined;
  if (typeof operationName === 'string') op = document.operations.find((o) => o.name === operationName);
  if (op === undefined) op = document.operations[0];
  if (op === undefined) return { errors: [{ message: 'No operation found' }] };
  const ctx: ExecCtx = { vars, fragments: document.fragments, errors: [] };
  const root = obj(op.type === 'mutation' ? 'Mutation' : 'Query', {});
  const data = executeSelection(root, op.selection, ctx);
  const result: GraphQLResult = { data };
  if (ctx.errors.length > 0) result.errors = ctx.errors;
  return result;
}
