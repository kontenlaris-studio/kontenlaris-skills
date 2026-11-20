// Pure-TypeScript git object machinery: SHA-1 object identity, loose object hashing,
// packfile reading (with OFS/REF delta resolution) and writing, tree/commit/tag parsing
// and construction, reachability, ancestry, three-way tree merges and line diffs.
// Everything runs on node:crypto and node:zlib; no git binary is ever invoked.

import { createHash } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';
import type { GitObj, ObjectStore } from './store.ts';

export const ZERO_OID = '0'.repeat(40);
const OID_RE = /^[0-9a-f]{40}$/;
export function isOid(value: string): boolean {
  return OID_RE.test(value);
}

export function sha1Hex(data: Buffer): string {
  return createHash('sha1').update(data).digest('hex');
}

/**
 * Object headers (`"<type> <length>\0"`) repeat constantly — every push stores
 * another 1 KiB blob under the same header — and they are immutable once built,
 * so they are memoized by their text. The map stays tiny (four types times the
 * lengths a workload actually stores); it is cleared if it ever grows past a
 * generous bound rather than being allowed to accumulate one entry per size.
 */
const headerCache = new Map<string, Buffer>();

function objectHeader(type: GitObj['type'], length: number): Buffer {
  const text = `${type} ${length}`;
  let header = headerCache.get(text);
  if (header === undefined) {
    header = Buffer.from(`${text}\0`, 'utf8');
    if (headerCache.size > 1024) headerCache.clear();
    headerCache.set(text, header);
  }
  return header;
}

/** Hash and store an object; returns its object id. */
export function putObject(store: ObjectStore, type: GitObj['type'], data: Buffer): string {
  const header = objectHeader(type, data.length);
  // Feed the hasher the header and the body as two writes: concatenating them
  // first would copy every object stored, only to hash the copy once.
  const oid = createHash('sha1').update(header).update(data).digest('hex');
  if (!store.has(oid)) store.set(oid, { type, data });
  return oid;
}

// ---------------------------------------------------------------------------
// Trees

export interface TreeEntry {
  mode: string; // '40000' for trees, '100644'/'100755'/'120000' for leaves, '160000' gitlink
  name: string;
  oid: string;
}

export function parseTree(data: Buffer): TreeEntry[] {
  const entries: TreeEntry[] = [];
  let pos = 0;
  while (pos < data.length) {
    const space = data.indexOf(0x20, pos);
    const mode = data.toString('ascii', pos, space);
    const nul = data.indexOf(0x00, space + 1);
    const name = data.toString('utf8', space + 1, nul);
    const oid = data.toString('hex', nul + 1, nul + 21);
    entries.push({ mode, name, oid });
    pos = nul + 21;
  }
  return entries;
}

function treeSortKey(entry: TreeEntry): string {
  return entry.mode === '40000' ? `${entry.name}/` : entry.name;
}

export function buildTreeData(entries: TreeEntry[]): Buffer {
  const sorted = [...entries].sort((a, b) => {
    const ka = treeSortKey(a);
    const kb = treeSortKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  const parts: Buffer[] = [];
  for (const entry of sorted) {
    parts.push(Buffer.from(`${entry.mode} ${entry.name}\0`, 'utf8'));
    parts.push(Buffer.from(entry.oid, 'hex'));
  }
  return Buffer.concat(parts);
}

/** Flatten a tree (recursively) into path -> leaf entry. Directories are traversed. */
export function flattenTree(store: ObjectStore, treeOid: string, prefix = '', out = new Map<string, { mode: string; oid: string }>()): Map<string, { mode: string; oid: string }> {
  const obj = store.get(treeOid);
  if (obj === undefined || obj.type !== 'tree') return out;
  for (const entry of parseTree(obj.data)) {
    const path = prefix + entry.name;
    if (entry.mode === '40000') flattenTree(store, entry.oid, `${path}/`, out);
    else out.set(path, { mode: entry.mode, oid: entry.oid });
  }
  return out;
}

/** Rebuild nested tree objects from a flattened path map; returns the root tree id. */
export function buildTreeFromFlat(store: ObjectStore, flat: Map<string, { mode: string; oid: string }>): string {
  interface Node {
    files: { name: string; mode: string; oid: string }[];
    dirs: Map<string, Node>;
  }
  const root: Node = { files: [], dirs: new Map() };
  for (const [path, leaf] of flat) {
    const segments = path.split('/');
    let node = root;
    for (let i = 0; i < segments.length - 1; i += 1) {
      let next = node.dirs.get(segments[i]);
      if (next === undefined) {
        next = { files: [], dirs: new Map() };
        node.dirs.set(segments[i], next);
      }
      node = next;
    }
    node.files.push({ name: segments[segments.length - 1], mode: leaf.mode, oid: leaf.oid });
  }
  const build = (node: Node): string => {
    const entries: TreeEntry[] = [];
    for (const file of node.files) entries.push({ mode: file.mode, name: file.name, oid: file.oid });
    for (const [name, dir] of node.dirs) entries.push({ mode: '40000', name, oid: build(dir) });
    return putObject(store, 'tree', buildTreeData(entries));
  };
  return build(root);
}

// ---------------------------------------------------------------------------
// Commits and tags

export interface CommitRec {
  tree: string;
  parents: string[];
  author: string;
  committer: string;
  message: string;
}

/**
 * Parsed commits are memoized by buffer identity: a stored object's bytes never
 * change, and the object store hands out the same Buffer for a given object, so a
 * parse paid once is never paid again. Callers only ever read the result.
 */
const commitParseCache = new WeakMap<Buffer, CommitRec>();

export function parseCommit(data: Buffer): CommitRec {
  const cached = commitParseCache.get(data);
  if (cached !== undefined) return cached;
  const parsed = parseCommitBytes(data);
  commitParseCache.set(data, parsed);
  return parsed;
}

function parseCommitBytes(data: Buffer): CommitRec {
  const text = data.toString('utf8');
  const split = text.indexOf('\n\n');
  const header = split === -1 ? text : text.slice(0, split);
  const message = split === -1 ? '' : text.slice(split + 2);
  let tree = '';
  const parents: string[] = [];
  let author = '';
  let committer = '';
  for (const line of header.split('\n')) {
    if (line.startsWith('tree ')) tree = line.slice(5).trim();
    else if (line.startsWith('parent ')) parents.push(line.slice(7).trim());
    else if (line.startsWith('author ')) author = line.slice(7);
    else if (line.startsWith('committer ')) committer = line.slice(10);
  }
  return { tree, parents, author, committer, message };
}

export function buildCommitData(rec: CommitRec): Buffer {
  let head = `tree ${rec.tree}\n`;
  for (const parent of rec.parents) head += `parent ${parent}\n`;
  head += `author ${rec.author}\ncommitter ${rec.committer}\n\n`;
  return Buffer.concat([Buffer.from(head, 'utf8'), Buffer.from(rec.message, 'utf8')]);
}

export function makeCommit(
  store: ObjectStore,
  rec: { tree: string; parents: string[]; message: string; ident: string },
): string {
  return putObject(store, 'commit', buildCommitData({
    tree: rec.tree,
    parents: rec.parents,
    author: rec.ident,
    committer: rec.ident,
    message: rec.message,
  }));
}

export interface TagRec {
  object: string;
  type: string;
  tag: string;
}

const tagParseCache = new WeakMap<Buffer, TagRec>();

export function parseTag(data: Buffer): TagRec {
  const cached = tagParseCache.get(data);
  if (cached !== undefined) return cached;
  const parsed = parseTagBytes(data);
  tagParseCache.set(data, parsed);
  return parsed;
}

function parseTagBytes(data: Buffer): TagRec {
  const text = data.toString('utf8');
  let object = '';
  let type = '';
  let tag = '';
  for (const line of text.split('\n')) {
    if (line === '') break;
    if (line.startsWith('object ')) object = line.slice(7).trim();
    else if (line.startsWith('type ')) type = line.slice(5).trim();
    else if (line.startsWith('tag ')) tag = line.slice(4).trim();
  }
  return { object, type, tag };
}

/** Follow tag objects until a non-tag object; returns that object's id (or the input). */
export function peelToCommit(store: ObjectStore, oid: string): string {
  let current = oid;
  for (let hops = 0; hops < 32; hops += 1) {
    const obj = store.get(current);
    if (obj === undefined) return current;
    if (obj.type === 'commit') return current;
    if (obj.type === 'tag') {
      current = parseTag(obj.data).object;
      continue;
    }
    return current; // tree/blob: not a commit, returned as-is
  }
  return current;
}

// ---------------------------------------------------------------------------
// Graph walks

/** All commit ancestors of `start` (inclusive), breadth-first, nearest first. */
export function commitAncestors(store: ObjectStore, start: string): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  const queue: string[] = [start];
  let head = 0;
  while (head < queue.length) {
    const oid = queue[head];
    head += 1;
    if (seen.has(oid)) continue;
    const obj = store.get(oid);
    if (obj === undefined || obj.type !== 'commit') continue;
    seen.add(oid);
    order.push(oid);
    for (const parent of parseCommit(obj.data).parents) queue.push(parent);
  }
  return order;
}

/**
 * Ancestry test with an early exit: the walk stops the moment the ancestor is
 * reached instead of enumerating the whole history. On a fast-forward push the
 * ancestor is the new commit's parent, so this is a step or two, not a traversal
 * of every commit the repository has ever taken.
 */
export function isAncestor(store: ObjectStore, ancestor: string, descendant: string): boolean {
  if (ancestor === descendant) return true;
  const seen = new Set<string>();
  const stack: string[] = [descendant];
  while (stack.length > 0) {
    const oid = stack.pop() as string;
    if (oid === ancestor) return true;
    if (seen.has(oid)) continue;
    seen.add(oid);
    const obj = store.get(oid);
    if (obj === undefined || obj.type !== 'commit') continue;
    for (const parent of parseCommit(obj.data).parents) {
      if (!seen.has(parent)) stack.push(parent);
    }
  }
  return false;
}

/** Nearest common ancestor of two commits, or null when histories are disjoint. */
export function mergeBase(store: ObjectStore, a: string, b: string): string | null {
  const ancestorsOfA = new Set(commitAncestors(store, a));
  for (const candidate of commitAncestors(store, b)) {
    if (ancestorsOfA.has(candidate)) return candidate;
  }
  return null;
}

/** Every object reachable from the given roots (commits, trees, blobs, tags). */
export function collectClosure(store: ObjectStore, roots: Iterable<string>): Set<string> {
  const out = new Set<string>();
  const stack = [...roots];
  while (stack.length > 0) {
    const oid = stack.pop() as string;
    if (out.has(oid)) continue;
    const obj = store.get(oid);
    if (obj === undefined) continue;
    out.add(oid);
    if (obj.type === 'commit') {
      const commit = parseCommit(obj.data);
      stack.push(commit.tree, ...commit.parents);
    } else if (obj.type === 'tree') {
      for (const entry of parseTree(obj.data)) stack.push(entry.oid);
    } else if (obj.type === 'tag') {
      stack.push(parseTag(obj.data).object);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Three-way tree merge (path level)

export interface MergeOutcome {
  ok: boolean;
  tree: string | null;
  conflicts: string[];
}

/**
 * Merge `theirs` into `ours` relative to `base` at whole-file granularity: a path changed
 * on only one side takes that side's version; changed identically on both sides takes it;
 * changed differently (or changed vs deleted) conflicts.
 */
export function threeWayMerge(store: ObjectStore, baseTree: string, oursTree: string, theirsTree: string): MergeOutcome {
  const base = flattenTree(store, baseTree);
  const ours = flattenTree(store, oursTree);
  const theirs = flattenTree(store, theirsTree);
  const paths = new Set<string>([...base.keys(), ...ours.keys(), ...theirs.keys()]);
  const merged = new Map<string, { mode: string; oid: string }>();
  const conflicts: string[] = [];
  const same = (x: { mode: string; oid: string } | undefined, y: { mode: string; oid: string } | undefined): boolean =>
    (x === undefined && y === undefined) || (x !== undefined && y !== undefined && x.oid === y.oid && x.mode === y.mode);
  for (const path of paths) {
    const b = base.get(path);
    const o = ours.get(path);
    const t = theirs.get(path);
    if (same(o, t)) {
      if (o !== undefined) merged.set(path, o);
    } else if (same(b, o)) {
      if (t !== undefined) merged.set(path, t);
    } else if (same(b, t)) {
      if (o !== undefined) merged.set(path, o);
    } else {
      conflicts.push(path);
    }
  }
  if (conflicts.length > 0) return { ok: false, tree: null, conflicts };
  return { ok: true, tree: buildTreeFromFlat(store, merged), conflicts: [] };
}

// ---------------------------------------------------------------------------
// Line diff (for pull request file stats)

function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Additions/deletions between two blob contents, via an LCS over lines (bounded). */
export function lineDiff(oldData: Buffer, newData: Buffer): { additions: number; deletions: number } {
  const a = splitLines(oldData.toString('utf8'));
  const b = splitLines(newData.toString('utf8'));
  if (a.length * b.length > 4_000_000) {
    return { additions: b.length, deletions: a.length };
  }
  // Classic LCS dynamic program over the shorter axis to bound memory.
  const dp: number[] = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    let prevDiag = 0;
    for (let j = 1; j <= b.length; j += 1) {
      const above = dp[j];
      if (a[i - 1] === b[j - 1]) dp[j] = prevDiag + 1;
      else dp[j] = Math.max(dp[j], dp[j - 1]);
      prevDiag = above;
    }
  }
  const common = dp[b.length];
  return { additions: b.length - common, deletions: a.length - common };
}

// ---------------------------------------------------------------------------
// Packfiles

const PACK_TYPES: Record<number, GitObj['type']> = {
  1: 'commit',
  2: 'tree',
  3: 'blob',
  4: 'tag',
};
const TYPE_CODES: Record<GitObj['type'], number> = { commit: 1, tree: 2, blob: 3, tag: 4 };

/** Inflate the zlib stream starting at `offset`; returns data and the offset just past it. */
function inflateAt(buffer: Buffer, offset: number): { data: Buffer; next: number } {
  const result = inflateSync(buffer.subarray(offset), { info: true }) as unknown as {
    buffer: Buffer;
    engine: { bytesWritten: number };
  };
  return { data: result.buffer, next: offset + result.engine.bytesWritten };
}

/** Apply a git delta (copy/insert instructions) to a base object's bytes. */
function applyDelta(base: Buffer, delta: Buffer): Buffer {
  let pos = 0;
  const readVarint = (): number => {
    let value = 0;
    let shift = 0;
    for (;;) {
      const byte = delta[pos];
      pos += 1;
      value |= (byte & 0x7f) << shift;
      shift += 7;
      if ((byte & 0x80) === 0) break;
    }
    return value;
  };
  readVarint(); // base size (trusted)
  const resultSize = readVarint();
  const chunks: Buffer[] = [];
  let produced = 0;
  while (pos < delta.length) {
    const op = delta[pos];
    pos += 1;
    if (op & 0x80) {
      let offset = 0;
      let size = 0;
      if (op & 0x01) { offset = delta[pos]; pos += 1; }
      if (op & 0x02) { offset |= delta[pos] << 8; pos += 1; }
      if (op & 0x04) { offset |= delta[pos] << 16; pos += 1; }
      if (op & 0x08) { offset |= delta[pos] << 24; pos += 1; }
      if (op & 0x10) { size = delta[pos]; pos += 1; }
      if (op & 0x20) { size |= delta[pos] << 8; pos += 1; }
      if (op & 0x40) { size |= delta[pos] << 16; pos += 1; }
      if (size === 0) size = 0x10000;
      chunks.push(base.subarray(offset, offset + size));
      produced += size;
    } else if (op !== 0) {
      chunks.push(delta.subarray(pos, pos + op));
      pos += op;
      produced += op;
    } else {
      throw new Error('delta opcode 0');
    }
  }
  const out = Buffer.concat(chunks);
  if (out.length !== resultSize) throw new Error('delta result size mismatch');
  void produced;
  return out;
}

interface PackEntry {
  offset: number;
  typeCode: number;
  data: Buffer;
  baseOffset?: number;
  baseOid?: string;
}

/**
 * Read a packfile into fully resolved objects. Delta bases may live in the pack itself
 * or (thin packs) in the target store. Throws on any structural problem.
 */
export function readPack(store: ObjectStore, pack: Buffer): Map<string, GitObj> {
  if (pack.length < 12 + 20) throw new Error('pack too short');
  if (pack.toString('ascii', 0, 4) !== 'PACK') throw new Error('bad pack signature');
  const version = pack.readUInt32BE(4);
  if (version !== 2 && version !== 3) throw new Error(`unsupported pack version ${version}`);
  const count = pack.readUInt32BE(8);
  const trailerStart = pack.length - 20;
  const entries: PackEntry[] = [];
  let sawDelta = false;
  let offset = 12;
  for (let i = 0; i < count; i += 1) {
    const entryOffset = offset;
    let byte = pack[offset];
    offset += 1;
    const typeCode = (byte >> 4) & 0x07;
    let size = byte & 0x0f;
    let shift = 4;
    while (byte & 0x80) {
      byte = pack[offset];
      offset += 1;
      size |= (byte & 0x7f) << shift;
      shift += 7;
    }
    const entry: PackEntry = { offset: entryOffset, typeCode, data: Buffer.alloc(0) };
    if (typeCode === 6 || typeCode === 7) sawDelta = true;
    if (typeCode === 6) {
      // OFS_DELTA
      byte = pack[offset];
      offset += 1;
      let baseOffset = byte & 0x7f;
      while (byte & 0x80) {
        byte = pack[offset];
        offset += 1;
        baseOffset = ((baseOffset + 1) << 7) | (byte & 0x7f);
      }
      entry.baseOffset = entryOffset - baseOffset;
    } else if (typeCode === 7) {
      // REF_DELTA
      entry.baseOid = pack.toString('hex', offset, offset + 20);
      offset += 20;
    }
    const inflated = inflateAt(pack, offset);
    if (inflated.data.length !== size) throw new Error('pack entry size mismatch');
    entry.data = inflated.data;
    offset = inflated.next;
    entries.push(entry);
  }
  if (offset !== trailerStart) throw new Error('pack length mismatch');

  if (!sawDelta) {
    // No deltas: every entry already holds its object's full bytes, so the
    // delta-resolution machinery below (offset index, cycle guard) has nothing
    // to resolve. Store the objects in pack order, exactly as it would.
    const resolved = new Map<string, GitObj>();
    for (const entry of entries) {
      const type = PACK_TYPES[entry.typeCode];
      if (type === undefined) throw new Error(`unknown pack type ${entry.typeCode}`);
      const obj: GitObj = { type, data: entry.data };
      resolved.set(putObject(store, obj.type, obj.data), obj);
    }
    return resolved;
  }

  const byOffset = new Map<number, PackEntry>();
  for (const entry of entries) byOffset.set(entry.offset, entry);
  const resolved = new Map<string, GitObj>();
  const resolving = new Set<number>();

  const resolveEntry = (entry: PackEntry): GitObj => {
    if (entry.typeCode !== 6 && entry.typeCode !== 7) {
      const type = PACK_TYPES[entry.typeCode];
      if (type === undefined) throw new Error(`unknown pack type ${entry.typeCode}`);
      return { type, data: entry.data };
    }
    if (resolving.has(entry.offset)) throw new Error('delta cycle');
    resolving.add(entry.offset);
    let base: GitObj;
    if (entry.typeCode === 6) {
      const baseEntry = byOffset.get(entry.baseOffset as number);
      if (baseEntry === undefined) throw new Error('ofs-delta base missing');
      base = resolveEntry(baseEntry);
    } else {
      const baseOid = entry.baseOid as string;
      base = resolved.get(baseOid) ?? store.get(baseOid) ?? (() => {
        // Base may be another pack entry not yet resolved; find and resolve it.
        for (const candidate of entries) {
          if (candidate.typeCode === 6 || candidate.typeCode === 7) continue;
          const obj = resolveEntry(candidate);
          const header = Buffer.from(`${obj.type} ${obj.data.length}\0`, 'utf8');
          if (sha1Hex(Buffer.concat([header, obj.data])) === baseOid) return obj;
        }
        throw new Error('ref-delta base missing');
      })();
    }
    resolving.delete(entry.offset);
    return { type: base.type, data: applyDelta(base.data, entry.data) };
  };

  for (const entry of entries) {
    const obj = resolveEntry(entry);
    // putObject already computed this object's id; hashing it a second time here
    // would just repeat the same SHA-1 over the same bytes.
    resolved.set(putObject(store, obj.type, obj.data), obj);
  }
  return resolved;
}

/** Write a packfile containing the given objects, undeltified, in the order given. */
export function writePack(objects: { type: GitObj['type']; data: Buffer }[]): Buffer {
  const parts: Buffer[] = [];
  const header = Buffer.alloc(12);
  header.write('PACK', 0, 'ascii');
  header.writeUInt32BE(2, 4);
  header.writeUInt32BE(objects.length, 8);
  parts.push(header);
  for (const obj of objects) {
    let size = obj.data.length;
    const first = (TYPE_CODES[obj.type] << 4) | (size & 0x0f);
    size >>= 4;
    const headerBytes: number[] = [];
    if (size === 0) {
      headerBytes.push(first);
    } else {
      headerBytes.push(first | 0x80);
      while (size > 0) {
        const b = size & 0x7f;
        size >>= 7;
        headerBytes.push(size > 0 ? b | 0x80 : b);
      }
    }
    parts.push(Buffer.from(headerBytes));
    parts.push(deflateSync(obj.data));
  }
  const body = Buffer.concat(parts);
  const trailer = createHash('sha1').update(body).digest();
  return Buffer.concat([body, trailer]);
}
