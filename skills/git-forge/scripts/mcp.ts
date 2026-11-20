// MCP endpoint at /mcp: stateless JSON-RPC 2.0 over plain POSTs. Answers the modern
// discovery handshake (server/discover) and the classic initialize, and serves six
// tools that operate on the same store as the REST and GraphQL surfaces, so state
// created through one surface is visible through the others.

import { forge, VIEWER } from './store.ts';
import { createIssue, createPull, issueJson, pullJson, repoJson } from './rest.ts';
import { mergePull } from './repops.ts';

const SUPPORTED_VERSIONS = ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'forge-mcp-server', version: '2.0.0' };

class RpcError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

class ToolFailure extends Error {}

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>) => unknown;
}

function repoOrFail(owner: unknown, repo: unknown) {
  const found = forge.getRepo(typeof owner === 'string' ? owner : '', typeof repo === 'string' ? repo : '');
  if (found === undefined) throw new ToolFailure(`repository not found: ${String(owner)}/${String(repo)}`);
  return found;
}

const TOOLS: ToolDef[] = [
  {
    name: 'create_repo',
    description: 'Create a new repository for the authenticated user.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Repository name' },
        description: { type: 'string', description: 'Repository description' },
        private: { type: 'boolean', description: 'Whether the repository is private' },
      },
      required: ['name'],
    },
    run: (args) => {
      const repo = forge.createRepo(
        String(args.name),
        typeof args.description === 'string' ? args.description : '',
        args.private === true,
      );
      if (repo === null) throw new ToolFailure(`repository already exists: ${String(args.name)}`);
      return repoJson(repo);
    },
  },
  {
    name: 'get_repo',
    description: 'Get a repository by owner and name.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner login' },
        repo: { type: 'string', description: 'Repository name' },
      },
      required: ['owner', 'repo'],
    },
    run: (args) => repoJson(repoOrFail(args.owner, args.repo)),
  },
  {
    name: 'create_issue',
    description: 'Create an issue in a repository.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner login' },
        repo: { type: 'string', description: 'Repository name' },
        title: { type: 'string', description: 'Issue title' },
        body: { type: 'string', description: 'Issue body' },
      },
      required: ['owner', 'repo', 'title'],
    },
    run: (args) => {
      const repo = repoOrFail(args.owner, args.repo);
      const created = createIssue(repo, {
        title: String(args.title),
        body: typeof args.body === 'string' ? args.body : '',
        labels: [],
      });
      if ('error' in created) throw new ToolFailure(created.error);
      return issueJson(repo, created);
    },
  },
  {
    name: 'list_issues',
    description: 'List issues in a repository, optionally filtered by state.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner login' },
        repo: { type: 'string', description: 'Repository name' },
        state: { type: 'string', description: 'Filter by state: open, closed, or all' },
      },
      required: ['owner', 'repo'],
    },
    run: (args) => {
      const repo = repoOrFail(args.owner, args.repo);
      const state = typeof args.state === 'string' ? args.state : 'open';
      let issues = [...repo.issues.values()];
      if (state === 'open') issues = issues.filter((i) => i.state === 'open');
      else if (state === 'closed') issues = issues.filter((i) => i.state === 'closed');
      issues.sort((a, b) => a.number - b.number);
      return issues.map((i) => issueJson(repo, i));
    },
  },
  {
    name: 'create_pull_request',
    description: 'Create a pull request from a head branch into a base branch.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner login' },
        repo: { type: 'string', description: 'Repository name' },
        title: { type: 'string', description: 'Pull request title' },
        head: { type: 'string', description: 'Head branch name' },
        base: { type: 'string', description: 'Base branch name' },
        body: { type: 'string', description: 'Pull request body' },
      },
      required: ['owner', 'repo', 'title', 'head', 'base'],
    },
    run: (args) => {
      const repo = repoOrFail(args.owner, args.repo);
      const created = createPull(repo, {
        title: String(args.title),
        body: typeof args.body === 'string' ? args.body : '',
        head: String(args.head),
        base: String(args.base),
      });
      if ('error' in created) throw new ToolFailure(created.error);
      return pullJson(repo, created);
    },
  },
  {
    name: 'merge_pull_request',
    description: 'Merge a pull request into its base branch.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { type: 'string', description: 'Repository owner login' },
        repo: { type: 'string', description: 'Repository name' },
        pull_number: { type: 'number', description: 'Pull request number' },
      },
      required: ['owner', 'repo', 'pull_number'],
    },
    run: (args) => {
      const repo = repoOrFail(args.owner, args.repo);
      const pull = repo.pulls.get(Number(args.pull_number));
      if (pull === undefined) throw new ToolFailure(`pull request not found: ${String(args.pull_number)}`);
      const result = mergePull(repo, pull, 'squash');
      if (!result.ok) throw new ToolFailure('Pull Request is not mergeable');
      return pullJson(repo, pull);
    },
  },
];

/** The tools/list result is a fixed literal so repeated calls are byte-identical. */
const TOOLS_LIST_RESULT = {
  tools: TOOLS.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })),
};

export interface McpReply {
  status: number;
  body?: unknown;
}

export function handleMcp(rawBody: Buffer): McpReply {
  let message: unknown;
  try {
    message = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return { status: 400, body: { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } } };
  }
  if (Array.isArray(message)) {
    const results = message.map((entry) => handleOne(entry).body).filter((b) => b !== undefined);
    return { status: 200, body: results };
  }
  return handleOne(message);
}

function handleOne(message: unknown): McpReply {
  if (message === null || typeof message !== 'object') {
    return { status: 200, body: { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } } };
  }
  const msg = message as { id?: unknown; method?: unknown; params?: unknown };
  const isNotification = !('id' in msg) || msg.id === undefined;
  const id = msg.id ?? null;
  const ok = (result: unknown): McpReply => ({ status: 200, body: { jsonrpc: '2.0', id, result } });
  const fail = (code: number, text: string): McpReply => ({
    status: 200,
    body: { jsonrpc: '2.0', id, error: { code, message: text } },
  });

  if (typeof msg.method !== 'string') {
    return isNotification ? { status: 202 } : fail(-32600, 'Invalid Request: method is required');
  }
  const params = msg.params !== null && typeof msg.params === 'object' ? (msg.params as Record<string, unknown>) : {};

  try {
    switch (msg.method) {
      case 'server/discover':
        return ok({
          resultType: 'complete',
          supportedVersions: SUPPORTED_VERSIONS,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
          _meta: { 'io.modelcontextprotocol/serverInfo': SERVER_INFO },
        });
      case 'initialize': {
        const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
        const protocolVersion = SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[1];
        return ok({ protocolVersion, capabilities: { tools: {} }, serverInfo: SERVER_INFO });
      }
      case 'ping':
        return ok({});
      case 'tools/list':
        return ok(TOOLS_LIST_RESULT);
      case 'tools/call': {
        const name = params.name;
        const tool = typeof name === 'string' ? TOOLS.find((t) => t.name === name) : undefined;
        if (tool === undefined) throw new RpcError(-32602, `Unknown tool: ${String(name)}`);
        const args = params.arguments !== null && typeof params.arguments === 'object'
          ? (params.arguments as Record<string, unknown>)
          : {};
        const required = (tool.inputSchema.required as string[] | undefined) ?? [];
        for (const key of required) {
          if (args[key] === undefined || args[key] === null) {
            throw new RpcError(-32602, `Missing required argument: ${key}`);
          }
        }
        let value: unknown;
        try {
          value = tool.run(args);
        } catch (err) {
          if (err instanceof ToolFailure) {
            return ok({
              content: [{ type: 'text', text: err.message }],
              isError: true,
            });
          }
          throw err;
        }
        return ok({
          content: [{ type: 'text', text: JSON.stringify(value) }],
          structuredContent: value,
          isError: false,
        });
      }
      default:
        if (isNotification || msg.method.startsWith('notifications/')) return { status: 202 };
        throw new RpcError(-32601, `Method not found: ${msg.method}`);
    }
  } catch (err) {
    if (err instanceof RpcError) return fail(err.code, err.message);
    return fail(-32603, err instanceof Error ? err.message : 'Internal error');
  }
}

export { VIEWER };
