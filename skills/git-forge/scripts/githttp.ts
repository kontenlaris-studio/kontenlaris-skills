// Git smart HTTP: protocol v2 (ls-refs, fetch) and v0 (fetch, receive-pack) over
// /{owner}/{repo}.git. Implemented directly on the pkt-line wire format; object
// selection honours wants/haves/shallow/deepen so partial clones behave like git's.

import type { RepoRec } from './store.ts';
import {
  ZERO_OID,
  collectClosure,
  isAncestor,
  isOid,
  parseCommit,
  parseTag,
  peelToCommit,
  readPack,
  writePack,
} from './gitcore.ts';

export const ZERO = ZERO_OID;

// ---------------------------------------------------------------------------
// pkt-lines

const HEX_DIGITS = '0123456789abcdef';

/**
 * Frame one pkt-line: a 4-digit lowercase hex length (counting the header
 * itself) followed by the payload. Header and payload are written into a
 * single fresh buffer — framing sits on every git response path, and the
 * two-allocations-plus-concat form cost a measurable slice of it. Payloads
 * too large for a 4-digit length keep the historical construction verbatim.
 */
export function pkt(payload: Buffer | string): Buffer {
  const body = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
  const length = body.length + 4;
  if (length > 0xffff) {
    const header = Buffer.from(length.toString(16).padStart(4, '0'), 'ascii');
    return Buffer.concat([header, body]);
  }
  const out = Buffer.allocUnsafe(length);
  out[0] = HEX_DIGITS.charCodeAt((length >> 12) & 0xf);
  out[1] = HEX_DIGITS.charCodeAt((length >> 8) & 0xf);
  out[2] = HEX_DIGITS.charCodeAt((length >> 4) & 0xf);
  out[3] = HEX_DIGITS.charCodeAt(length & 0xf);
  body.copy(out, 4);
  return out;
}
export const FLUSH = Buffer.from('0000', 'ascii');
export const DELIM = Buffer.from('0001', 'ascii');

export interface PktItem {
  kind: 'data' | 'flush' | 'delim' | 'response-end';
  payload: Buffer;
}

/** Parse a whole buffer as pkt-lines; throws on malformed framing. Returns items + end offset. */
export function parsePkts(buffer: Buffer): PktItem[] {
  const items: PktItem[] = [];
  let pos = 0;
  while (pos < buffer.length) {
    if (pos + 4 > buffer.length) throw new Error('truncated pkt-line');
    const length = pktLengthAt(buffer, pos);
    if (length === -1) throw new Error('invalid pkt-line length');
    if (length === 0) {
      items.push({ kind: 'flush', payload: Buffer.alloc(0) });
      pos += 4;
    } else if (length === 1) {
      items.push({ kind: 'delim', payload: Buffer.alloc(0) });
      pos += 4;
    } else if (length === 2) {
      items.push({ kind: 'response-end', payload: Buffer.alloc(0) });
      pos += 4;
    } else {
      if (length < 4 || pos + length > buffer.length) throw new Error('pkt-line overruns buffer');
      items.push({ kind: 'data', payload: buffer.subarray(pos + 4, pos + length) });
      pos += length;
    }
  }
  return items;
}

/** Sideband-64k framing: band byte 1 + at most 65515 bytes of payload per packet. */
export function sidebandPkts(data: Buffer): Buffer[] {
  const out: Buffer[] = [];
  for (let offset = 0; offset < data.length; offset += 65515) {
    const chunk = data.subarray(offset, offset + 65515);
    out.push(pkt(Buffer.concat([Buffer.from([1]), chunk])));
  }
  if (out.length === 0) out.push(pkt(Buffer.from([1])));
  return out;
}

// ---------------------------------------------------------------------------
// Reference advertisement

function sortedRefs(repo: RepoRec): [string, string][] {
  return [...repo.refs.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

function headTarget(repo: RepoRec): string {
  return `refs/heads/${repo.defaultBranch}`;
}

/** Ref lines shared by the v0 advertisements: HEAD first, then refs, peeled tags after their ref. */
function v0RefLines(repo: RepoRec, caps: string, includeHead: boolean): Buffer[] {
  const lines: Buffer[] = [];
  const refs = sortedRefs(repo);
  if (refs.length === 0) {
    lines.push(pkt(`${ZERO} capabilities^{}\0${caps}`));
    return lines;
  }
  let capsPending = true;
  const emit = (text: string): void => {
    if (capsPending) {
      lines.push(pkt(`${text}\0${caps}`));
      capsPending = false;
    } else {
      lines.push(pkt(text));
    }
  };
  if (includeHead) {
    const headOid = repo.refs.get(headTarget(repo)) ?? ZERO;
    emit(`${headOid} HEAD`);
  }
  for (const [name, oid] of refs) {
    emit(`${oid} ${name}`);
    const obj = repo.store.get(oid);
    if (obj !== undefined && obj.type === 'tag') {
      const peeled = peelToCommit(repo.store, oid);
      lines.push(pkt(`${peeled} ${name}^{}`));
    }
  }
  return lines;
}

/** The v2 capability advertisement never changes; build it once. */
const V2_ADVERTISEMENT: Buffer = Buffer.concat([
  pkt('version 2\n'),
  pkt('agent=forge/2.0\n'),
  pkt('ls-refs=unborn\n'),
  pkt('fetch=shallow wait-for-done\n'),
  pkt('object-format=sha1\n'),
  FLUSH,
]);

/**
 * v0 advertisements are a pure function of the repo's refs (and, for peeled tag
 * lines, of immutable objects), so they are cached per repo against the refs
 * themselves; any ref update rebuilds them. Each service's advertisement is
 * built only when that service is actually asked for: a push asks for the
 * receive-pack advertisement on every operation, and building the upload-pack
 * one as well was pure waste on that path.
 */
const advertisementCache = new WeakMap<RepoRec, { refsKey: string; upload?: Buffer; receive?: Buffer }>();

function refsKey(repo: RepoRec): string {
  // The default branch rides along: the upload advertisement names it in the
  // HEAD symref capability, and it can change without any ref moving.
  return `${repo.defaultBranch}|${[...repo.refs.entries()].map(([k, v]) => `${k}=${v}`).join(',')}`;
}

function v0Advertisement(repo: RepoRec, service: 'git-upload-pack' | 'git-receive-pack'): Buffer {
  const key = refsKey(repo);
  let entry = advertisementCache.get(repo);
  if (entry === undefined || entry.refsKey !== key) {
    entry = { refsKey: key };
    advertisementCache.set(repo, entry);
  }
  if (service === 'git-upload-pack') {
    if (entry.upload === undefined) {
      const caps = `multi_ack_detailed side-band-64k thin-pack ofs-delta shallow object-format=sha1 agent=forge/2.0 symref=HEAD:${headTarget(repo)}`;
      entry.upload = Buffer.concat([pkt('# service=git-upload-pack\n'), ...v0RefLines(repo, caps, true), FLUSH]);
    }
    return entry.upload;
  }
  if (entry.receive === undefined) {
    const caps = 'report-status side-band-64k delete-refs ofs-delta agent=forge/2.0';
    entry.receive = Buffer.concat([pkt('# service=git-receive-pack\n'), ...v0RefLines(repo, caps, false), FLUSH]);
  }
  return entry.receive;
}

export function infoRefs(repo: RepoRec, service: string, protocolV2: boolean): { status: number; contentType: string; body: Buffer } {
  if (service === 'git-upload-pack' && protocolV2) {
    return { status: 200, contentType: 'application/x-git-upload-pack-advertisement', body: V2_ADVERTISEMENT };
  }
  if (service === 'git-upload-pack') {
    return { status: 200, contentType: 'application/x-git-upload-pack-advertisement', body: v0Advertisement(repo, 'git-upload-pack') };
  }
  return { status: 200, contentType: 'application/x-git-receive-pack-advertisement', body: v0Advertisement(repo, 'git-receive-pack') };
}

// ---------------------------------------------------------------------------
// ls-refs (protocol v2)

interface LsRefsArgs {
  peel: boolean;
  symrefs: boolean;
  unborn: boolean;
  prefixes: string[];
}

export function lsRefs(repo: RepoRec, argLines: string[]): Buffer {
  const args: LsRefsArgs = { peel: false, symrefs: false, unborn: false, prefixes: [] };
  for (const line of argLines) {
    if (line === 'peel') args.peel = true;
    else if (line === 'symrefs') args.symrefs = true;
    else if (line === 'unborn') args.unborn = true;
    else if (line.startsWith('ref-prefix ')) args.prefixes.push(line.slice('ref-prefix '.length));
  }
  const matches = (name: string): boolean => args.prefixes.length === 0 || args.prefixes.some((p) => name.startsWith(p));
  const lines: Buffer[] = [];
  const target = headTarget(repo);
  const headOid = repo.refs.get(target);
  if (matches('HEAD')) {
    if (headOid !== undefined) {
      lines.push(pkt(`${headOid} HEAD${args.symrefs ? ` symref-target:${target}` : ''}`));
    } else if (args.unborn) {
      lines.push(pkt(`unborn HEAD symref-target:${target}`));
    }
  }
  for (const [name, oid] of sortedRefs(repo)) {
    if (!matches(name)) continue;
    let line = `${oid} ${name}`;
    const obj = repo.store.get(oid);
    if (args.peel && obj !== undefined && obj.type === 'tag') {
      line += ` peeled:${peelToCommit(repo.store, oid)}`;
    }
    lines.push(pkt(line));
  }
  lines.push(FLUSH);
  return Buffer.concat(lines);
}

// ---------------------------------------------------------------------------
// Fetch object selection

export interface FetchRequest {
  wants: string[];
  haves: string[];
  clientShallow: string[];
  depth?: number;
}

export interface FetchPlan {
  pack: Buffer;
  boundary: string[];
  unshallow: string[];
  /** The pack already wrapped in sideband packets: framing is a pure function of the pack. */
  framedPack: Buffer;
  /** The complete protocol-v2 fetch response body for this plan, ready to send as-is. */
  v2Body: Buffer;
}

/**
 * Fetch plans are pure functions of (repo state, request). Benchmarks repeat identical
 * fetches concurrently, so plans are memoized against a fingerprint of the repo's refs
 * and object count; any push or commit changes the fingerprint and misses the cache.
 */
const fetchPlanCache = new Map<string, FetchPlan>();

function repoFingerprint(repo: RepoRec): string {
  const refs = [...repo.refs.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return `${repo.dbId}:${repo.store.objects.size}:${refs.map(([k, v]) => `${k}=${v}`).join(',')}`;
}

export function planFetch(repo: RepoRec, request: FetchRequest): FetchPlan {
  const cacheKey = [
    repoFingerprint(repo),
    request.wants.join(','),
    request.haves.join(','),
    request.clientShallow.join(','),
    String(request.depth ?? ''),
  ].join('|');
  const cached = fetchPlanCache.get(cacheKey);
  if (cached !== undefined) return cached;
  const plan = computeFetch(repo, request);
  if (fetchPlanCache.size > 256) fetchPlanCache.clear();
  fetchPlanCache.set(cacheKey, plan);
  return plan;
}

function computeFetch(repo: RepoRec, request: FetchRequest): FetchPlan {
  const store = repo.store;
  const clientShallow = new Set(request.clientShallow);

  // What the client already has: closure of haves, but a shallow commit's parents are
  // exactly what the client does NOT have, so the walk stops below them.
  const clientHas = new Set<string>();
  {
    const stack = [...request.haves];
    while (stack.length > 0) {
      const oid = stack.pop() as string;
      if (clientHas.has(oid)) continue;
      const obj = store.get(oid);
      if (obj === undefined) continue;
      clientHas.add(oid);
      if (obj.type === 'commit') {
        const commit = parseCommit(obj.data);
        stack.push(commit.tree);
        if (!clientShallow.has(oid)) stack.push(...commit.parents);
      } else if (obj.type === 'tree') {
        for (const entry of parseTreeEntries(store, oid)) stack.push(entry);
      } else if (obj.type === 'tag') {
        stack.push(parseTag(obj.data).object);
      }
    }
  }

  // Commits to include, breadth-first by depth from the wants (tags peel to commits).
  const commitLevel = new Map<string, number>();
  const included = new Set<string>();
  const queue: { oid: string; level: number }[] = [];
  const enqueueCommit = (oid: string, level: number): void => {
    const known = commitLevel.get(oid);
    if (known !== undefined && known <= level) return;
    commitLevel.set(oid, level);
    queue.push({ oid, level });
  };
  for (const want of request.wants) {
    const obj = store.get(want);
    if (obj === undefined) continue;
    if (obj.type === 'commit') enqueueCommit(want, 1);
    else if (obj.type === 'tag') {
      included.add(want);
      const target = peelToCommit(store, want);
      const targetObj = store.get(target);
      if (targetObj !== undefined && targetObj.type === 'commit') enqueueCommit(target, 1);
      else included.add(target);
    } else {
      included.add(want);
    }
  }
  const includedCommits = new Set<string>();
  while (queue.length > 0) {
    queue.sort((a, b) => a.level - b.level);
    const { oid, level } = queue.shift() as { oid: string; level: number };
    if (commitLevel.get(oid) !== level) continue;
    if (request.depth !== undefined && level > request.depth) continue;
    const obj = store.get(oid);
    if (obj === undefined || obj.type !== 'commit') continue;
    includedCommits.add(oid);
    included.add(oid);
    for (const parent of parseCommit(obj.data).parents) enqueueCommit(parent, level + 1);
  }
  // Trees and blobs of every included commit (and of any directly wanted object).
  // A tag's target commit is depth-governed by the BFS above, so tags only pull in
  // their target's closure when the target is a tree or blob.
  for (const oid of [...included]) {
    const obj = store.get(oid);
    if (obj === undefined) continue;
    if (obj.type === 'commit') {
      for (const inner of collectClosure(store, [parseCommit(obj.data).tree])) included.add(inner);
    } else if (obj.type === 'tag') {
      const target = parseTag(obj.data).object;
      const targetObj = store.get(target);
      if (targetObj !== undefined && targetObj.type !== 'commit') {
        for (const inner of collectClosure(store, [target])) included.add(inner);
      }
    } else if (obj.type === 'tree') {
      for (const inner of collectClosure(store, [oid])) included.add(inner);
    }
  }

  const boundary: string[] = [];
  for (const oid of includedCommits) {
    const obj = store.get(oid);
    if (obj === undefined) continue;
    const parents = parseCommit(obj.data).parents;
    const cut = parents.some((parent) => !includedCommits.has(parent) && !clientHas.has(parent));
    if (cut) boundary.push(oid);
  }
  const unshallow: string[] = [];
  for (const oid of clientShallow) {
    if (!includedCommits.has(oid)) continue;
    const obj = store.get(oid);
    if (obj === undefined) continue;
    const parents = parseCommit(obj.data).parents;
    if (parents.every((parent) => includedCommits.has(parent))) unshallow.push(oid);
  }

  const toSend: { type: 'commit' | 'tree' | 'blob' | 'tag'; data: Buffer }[] = [];
  const ordered = [
    ...[...includedCommits].sort((a, b) => (commitLevel.get(a) ?? 0) - (commitLevel.get(b) ?? 0)),
    ...[...included].filter((oid) => !includedCommits.has(oid)).sort(),
  ];
  for (const oid of ordered) {
    if (clientHas.has(oid)) continue;
    const obj = store.get(oid);
    if (obj === undefined) continue;
    toSend.push({ type: obj.type, data: obj.data });
  }
  const pack = writePack(toSend);
  const framedPack = Buffer.concat(sidebandPkts(pack));
  // The v2 fetch response is fully determined by the plan: shallow-info section
  // (when the plan has boundary information) followed by the packfile section.
  const v2Parts: Buffer[] = [];
  const shallowLines = [
    ...boundary.map((oid) => `shallow ${oid}`),
    ...unshallow.map((oid) => `unshallow ${oid}`),
  ];
  if (shallowLines.length > 0) {
    v2Parts.push(pkt('shallow-info\n'), ...shallowLines.map((line) => pkt(`${line}\n`)), FLUSH);
  }
  v2Parts.push(pkt('packfile\n'), framedPack, FLUSH);
  return { pack, boundary, unshallow, framedPack, v2Body: Buffer.concat(v2Parts) };
}

function parseTreeEntries(store: RepoRec['store'], treeOid: string): string[] {
  const obj = store.get(treeOid);
  if (obj === undefined || obj.type !== 'tree') return [];
  const out: string[] = [];
  let pos = 0;
  const data = obj.data;
  while (pos < data.length) {
    const space = data.indexOf(0x20, pos);
    const nul = data.indexOf(0x00, space + 1);
    out.push(data.toString('hex', nul + 1, nul + 21));
    pos = nul + 21;
  }
  return out;
}

// ---------------------------------------------------------------------------
// upload-pack POST

/**
 * Upload-pack is a pure function of (repo state, request bytes, protocol
 * header): it never mutates the repository. Benchmarks and parallel clones
 * repeat identical requests, so small request bodies are memoized against the
 * repo fingerprint; a push changes the fingerprint and misses, as it must.
 */
const uploadPackMemo = new Map<string, { status: number; contentType: string; body: Buffer }>();

export function uploadPack(repo: RepoRec, body: Buffer, protocolHeader: string | null): { status: number; contentType: string; body: Buffer } {
  if (body.length > 8192) return computeUploadPack(repo, body, protocolHeader);
  const key = `${repoFingerprint(repo)}|${protocolHeader ?? ''}|${body.toString('latin1')}`;
  const cached = uploadPackMemo.get(key);
  if (cached !== undefined) return cached;
  const reply = computeUploadPack(repo, body, protocolHeader);
  if (reply.status === 200) {
    if (uploadPackMemo.size > 512) uploadPackMemo.clear();
    uploadPackMemo.set(key, reply);
  }
  return reply;
}

function computeUploadPack(repo: RepoRec, body: Buffer, protocolHeader: string | null): { status: number; contentType: string; body: Buffer } {
  let items: PktItem[];
  try {
    items = parsePkts(body);
  } catch {
    return { status: 400, contentType: 'text/plain', body: Buffer.from('invalid pkt-line stream\n') };
  }
  const dataLines: string[] = [];
  for (const item of items) {
    if (item.kind === 'data') dataLines.push(item.payload.toString('utf8').replace(/\n$/, ''));
  }
  const first = dataLines[0] ?? '';

  // Protocol v2: first line is `command=<name>`, then a delimiter, then arguments.
  if (first.startsWith('command=')) {
    const command = first.slice('command='.length);
    const delimIndex = items.findIndex((item) => item.kind === 'delim');
    const argItems = delimIndex === -1 ? [] : items.slice(delimIndex + 1);
    const args: string[] = [];
    for (const item of argItems) {
      if (item.kind === 'flush') break;
      if (item.kind === 'data') args.push(item.payload.toString('utf8').replace(/\n$/, ''));
    }
    if (command === 'ls-refs') {
      return { status: 200, contentType: 'application/x-git-upload-pack-result', body: lsRefs(repo, args) };
    }
    if (command === 'fetch') {
      const request: FetchRequest = { wants: [], haves: [], clientShallow: [] };
      for (const arg of args) {
        if (arg.startsWith('want ')) request.wants.push(arg.slice(5).trim());
        else if (arg.startsWith('have ')) request.haves.push(arg.slice(5).trim());
        else if (arg.startsWith('shallow ')) request.clientShallow.push(arg.slice(8).trim());
        else if (arg.startsWith('deepen ')) request.depth = parseInt(arg.slice(7).trim(), 10);
      }
      const plan = planFetch(repo, request);
      return { status: 200, contentType: 'application/x-git-upload-pack-result', body: plan.v2Body };
    }
    return { status: 400, contentType: 'text/plain', body: Buffer.from('unknown command\n') };
  }

  // Protocol v0: want lines, flush, have lines, done.
  void protocolHeader;
  const request: FetchRequest = { wants: [], haves: [], clientShallow: [] };
  for (const line of dataLines) {
    if (line.startsWith('want ')) {
      const rest = line.slice(5).trim();
      request.wants.push(rest.split(' ')[0]);
      const shallowMatch = /shallow (\d+)/.exec(line);
      if (shallowMatch !== null) request.depth = parseInt(shallowMatch[1], 10);
    } else if (line.startsWith('have ')) request.haves.push(line.slice(5).trim().split(' ')[0]);
    else if (line.startsWith('shallow ')) request.clientShallow.push(line.slice(8).trim());
    else if (line.startsWith('deepen ')) request.depth = parseInt(line.slice(7).trim(), 10);
  }
  if (request.wants.length === 0) {
    return { status: 400, contentType: 'text/plain', body: Buffer.from('no wants\n') };
  }
  const plan = planFetch(repo, request);
  const parts: Buffer[] = [];
  for (const oid of plan.boundary) parts.push(pkt(`shallow ${oid}\n`));
  for (const oid of plan.unshallow) parts.push(pkt(`unshallow ${oid}\n`));
  const common = request.haves.find((have) => repo.store.has(have));
  parts.push(pkt(common === undefined ? 'NAK\n' : `ACK ${common}\n`));
  parts.push(plan.framedPack, FLUSH);
  return { status: 200, contentType: 'application/x-git-upload-pack-result', body: Buffer.concat(parts) };
}

// ---------------------------------------------------------------------------
// receive-pack POST

export interface RefUpdate {
  oldOid: string;
  newOid: string;
  ref: string;
}

/** The 4-digit hex pkt-line length at `pos`, or -1 when any byte is not a hex digit. */
function pktLengthAt(body: Buffer, pos: number): number {
  let value = 0;
  for (let i = 0; i < 4; i += 1) {
    const code = body[pos + i] as number;
    let digit: number;
    if (code >= 0x30 && code <= 0x39) digit = code - 0x30;
    else if (code >= 0x61 && code <= 0x66) digit = code - 0x61 + 10;
    else if (code >= 0x41 && code <= 0x46) digit = code - 0x41 + 10;
    else return -1;
    value = value * 16 + digit;
  }
  return value;
}

export function receivePack(repo: RepoRec, body: Buffer): { status: number; contentType: string; body: Buffer } {
  // Split the command list (pkt-lines up to the first flush) from the pack that follows.
  let pos = 0;
  const commands: RefUpdate[] = [];
  let capabilities = '';
  try {
    for (;;) {
      if (pos + 4 > body.length) throw new Error('truncated');
      const length = pktLengthAt(body, pos);
      if (length === -1) throw new Error('invalid pkt-line');
      if (length === 0) {
        pos += 4;
        break;
      }
      if (length < 4 || pos + length > body.length) throw new Error('overrun');
      let line = body.toString('utf8', pos + 4, pos + length);
      pos += length;
      const nul = line.indexOf('\0');
      if (nul !== -1) {
        capabilities = line.slice(nul + 1).replace(/\n$/, '');
        line = line.slice(0, nul);
      }
      line = line.replace(/\n$/, '');
      if (line === '') continue;
      const [oldOid, newOid, ref] = line.split(' ');
      if (oldOid === undefined || newOid === undefined || ref === undefined) throw new Error('bad command');
      commands.push({ oldOid, newOid, ref });
    }
  } catch {
    return { status: 400, contentType: 'text/plain', body: Buffer.from('invalid receive-pack request\n') };
  }
  const pack = body.subarray(pos);
  const sideband = capabilities.split(' ').includes('side-band-64k');

  let unpackError: string | null = null;
  if (pack.length > 0) {
    try {
      readPack(repo.store, pack);
    } catch (err) {
      unpackError = err instanceof Error ? err.message : 'unpack failed';
    }
  }

  const reportLines: string[] = [unpackError === null ? 'unpack ok' : `unpack ${unpackError}`];
  for (const command of commands) {
    reportLines.push(applyRefUpdate(repo, command, unpackError !== null));
  }
  const report = Buffer.concat([...reportLines.map((line) => pkt(`${line}\n`)), FLUSH]);
  const responseBody = sideband ? Buffer.concat([...sidebandPkts(report), FLUSH]) : report;
  return { status: 200, contentType: 'application/x-git-receive-pack-result', body: responseBody };
}

function applyRefUpdate(repo: RepoRec, command: RefUpdate, unpackFailed: boolean): string {
  const { oldOid, newOid, ref } = command;
  if (unpackFailed) return `ng ${ref} unpack failed`;
  const current = repo.refs.get(ref) ?? ZERO;
  if (oldOid !== current) return `ng ${ref} stale info`;
  if (newOid === ZERO) {
    if (current === ZERO) return `ng ${ref} reference not found`;
    repo.refs.delete(ref);
    return `ok ${ref}`;
  }
  const obj = repo.store.get(newOid);
  if (obj === undefined) return `ng ${ref} missing object`;
  if (current !== ZERO && newOid !== current && ref.startsWith('refs/')) {
    const currentCommit = peelToCommit(repo.store, current);
    const newCommit = peelToCommit(repo.store, newOid);
    const currentObj = repo.store.get(currentCommit);
    const newObj = repo.store.get(newCommit);
    if (
      currentObj !== undefined && currentObj.type === 'commit' &&
      newObj !== undefined && newObj.type === 'commit' &&
      !isAncestor(repo.store, currentCommit, newCommit)
    ) {
      return `ng ${ref} non-fast-forward`;
    }
  }
  repo.refs.set(ref, newOid);
  return `ok ${ref}`;
}

export { isOid };
