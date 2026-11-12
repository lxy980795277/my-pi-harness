import type Database from 'better-sqlite3';
import { Type, type Static } from 'typebox';
import type {
  SearchIndexStatus,
  SearchSourceRef,
  SearchSourceSelection,
  SearchSourceReadInput,
  SearchSourceExcerpt,
  SearchSourceWindow,
} from '@my-pi-harness/protocol';
import type {
  SearchAccess,
  SearchChunkWrite,
  SearchLexicalCandidate,
  SearchSourcePage,
  SearchSourceSnapshot,
  SearchVectorPage,
  SearchVectorWrite,
  SearchPendingVectorChunk,
  SearchQueryReadiness,
} from '@my-pi-harness/protocol/internal';
import { checked } from '../shared/validation';
import { StorageError } from '../shared/errors';
import { PersistentSearchSources, sourcePredicate } from './sources';
import { PersistentSourceReader } from './source-window';

type State = Static<typeof StateSchema>;
type IndexedSource = Static<typeof IndexedSourceSchema>;
interface VectorOptions {
  modelSignature: string;
  generation?: number;
  after?: number;
  limit?: number;
}
interface IndexFreshness {
  state: State;
  pendingSources: number;
  lexicalReady: boolean;
  complete: boolean;
}

const StateSchema = Type.Object({
  active: Type.Integer(),
  building: Type.Union([Type.Integer(), Type.Null()]),
  lexicalReady: Type.Integer(),
  error: Type.Union([Type.String(), Type.Null()]),
});
const IndexedSourceSchema = Type.Object({
  generation: Type.Integer(),
  id: Type.String(),
  kind: Type.Union([Type.Literal('memory'), Type.Literal('message')]),
  hash: Type.String(),
  revision: Type.Integer(),
  signature: Type.String(),
});
const CountSchema = Type.Object({ count: Type.Integer({ minimum: 0 }) });
const candidateFields = {
  chunkId: Type.Integer(),
  sourceId: Type.String(),
  kind: Type.Union([Type.Literal('memory'), Type.Literal('message')]),
  hash: Type.String(),
  start: Type.Integer(),
  end: Type.Integer(),
  text: Type.String(),
};
const LexicalCandidateSchema = Type.Object({ ...candidateFields, rank: Type.Number() });
const VectorCandidateSchema = Type.Object({
  ...candidateFields,
  dimensions: Type.Integer({ minimum: 1, maximum: 2048 }),
  vector: Type.Unknown(),
});
const SignatureRowSchema = Type.Object({ signature: Type.String() });
const ChunkIdRowSchema = Type.Object({ id: Type.Integer() });
const GenerationRowSchema = Type.Object({ generation: Type.Integer() });
const WatermarkRowSchema = Type.Object({ watermark: Type.Union([Type.String(), Type.Null()]) });
const PendingVectorChunkSchema = Type.Object({
  ordinal: Type.Integer({ minimum: 0 }),
  start: Type.Integer({ minimum: 0 }),
  end: Type.Integer({ minimum: 1 }),
  text: Type.String({ maxLength: 16_000 }),
});
const ChunkSchema = Type.Object({
  id: Type.Integer(),
  ordinal: Type.Integer(),
  start: Type.Integer(),
  end: Type.Integer(),
  text: Type.String(),
  tokens: Type.String(),
});
const SOURCE_COLUMNS = 'generation,id,kind,content_hash AS hash,revision,signature';
const STATE_COLUMNS =
  'active_generation AS active,building_generation AS building,lexical_ready AS lexicalReady,error';
const CREATE_FTS = "CREATE VIRTUAL TABLE search_fts USING fts5(tokens,tokenize='unicode61')";

/** Derived search tables share profile transactions; current source predicates precede every engine limit. */
export class SearchRepository {
  private readonly sourceQueries: PersistentSearchSources;
  private readonly sourceReader: PersistentSourceReader;

  public constructor(
    private readonly sqlite: Database.Database,
    private readonly transact: <T>(operation: () => T, readOnly?: boolean) => T,
    private readonly profileOwner: () => string | undefined,
  ) {
    this.sourceQueries = new PersistentSearchSources(sqlite);
    this.sourceReader = new PersistentSourceReader(sqlite, this.sourceQueries);
  }

  public sources(input: { after?: string; limit?: number } = {}): SearchSourcePage {
    return this.owned((owner) => this.sourceQueries.page(owner, input), true);
  }

  public source(access: SearchAccess, ref: SearchSourceRef): SearchSourceSnapshot | null {
    return this.owned((owner) => {
      this.assertAccess(owner, access);
      return this.sourceQueries.resolve(access, ref);
    }, true);
  }

  public readSelection(
    access: SearchAccess,
    selection: SearchSourceSelection,
  ): SearchSourceExcerpt | null {
    return this.owned((owner) => {
      this.assertAccess(owner, access);
      return this.sourceReader.readSelection(access, selection);
    }, true);
  }

  public sourceWindow(
    access: SearchAccess,
    input: SearchSourceReadInput,
  ): SearchSourceWindow | null {
    return this.owned((owner) => {
      this.assertAccess(owner, access);
      return this.sourceReader.window(access, input);
    }, true);
  }

  public watermark(access?: SearchAccess): string {
    return this.owned((owner) => {
      if (access !== undefined) this.assertAccess(owner, access);
      return this.sourceQueries.watermark(owner, access);
    }, true);
  }

  /** Read the active generation for publication checks without computing index statistics. */
  public activeGeneration(): number {
    return this.owned(() => this.state().active, true);
  }

  public generationSignature(generation: number): string | null {
    return this.owned(() => {
      const row: unknown = this.sqlite
        .prepare('SELECT signature FROM search_generations WHERE id=?')
        .get(generation);
      return row === undefined ? null : checked(SignatureRowSchema, row).signature;
    }, true);
  }

  public indexed(
    ref: SearchSourceRef,
    generation: number,
    signature: string,
    modelSignature?: string,
  ): { chunks: boolean; vectors: boolean } {
    return this.owned(() => {
      const source = this.indexedSource(generation, ref.id);
      if (
        !source ||
        source.hash !== ref.contentHash ||
        source.kind !== ref.kind ||
        source.signature !== signature ||
        !this.validSource(source) ||
        !this.hasAllFts(generation, ref.id)
      )
        return { chunks: false, vectors: false };
      const missing =
        modelSignature === undefined
          ? 1
          : this.count(
              `SELECT COUNT(*) AS count FROM search_chunks c WHERE c.generation=? AND c.source_id=?
        AND NOT EXISTS(SELECT 1 FROM search_vectors v WHERE v.chunk_id=c.id AND v.model_signature=?)`,
              generation,
              ref.id,
              modelSignature,
            );
      return { chunks: true, vectors: missing === 0 };
    }, true);
  }

  public pendingVectorChunks(
    ref: SearchSourceRef,
    generation: number,
    signature: string,
    modelSignature: string,
    input: { afterOrdinal?: number; limit?: number } = {},
  ): SearchPendingVectorChunk[] {
    return this.owned(() => {
      const limit = input.limit ?? 4;
      bounded(limit, 1, 4);
      const source = this.indexedSource(generation, ref.id);
      if (
        !this.writable(generation) ||
        !source ||
        source.hash !== ref.contentHash ||
        source.kind !== ref.kind ||
        source.signature !== signature ||
        !this.validSource(source)
      )
        return [];
      return this.sqlite
        .prepare(
          `SELECT c.ordinal,c.start_offset AS start,c.end_offset AS end,c.text
        FROM search_chunks c WHERE c.generation=? AND c.source_id=? AND c.ordinal>?
        AND NOT EXISTS(SELECT 1 FROM search_vectors v WHERE v.chunk_id=c.id AND v.model_signature=?)
        ORDER BY c.ordinal LIMIT ?`,
        )
        .all(generation, ref.id, input.afterOrdinal ?? -1, modelSignature, limit)
        .map((row) => checked(PendingVectorChunkSchema, row));
    }, true);
  }

  public beginRebuild(signature: string): number {
    nonempty(signature, 500);
    return this.owned(() => {
      this.ensureFts();
      const state = this.state();
      if (state.building !== null) this.removeGeneration(state.building);
      const generation = Number(
        this.sqlite
          .prepare('INSERT INTO search_generations(signature,watermark) VALUES (?,NULL)')
          .run(signature).lastInsertRowid,
      );
      this.sqlite
        .prepare('UPDATE search_index_state SET building_generation=?,error=NULL WHERE id=1')
        .run(generation);
      return generation;
    });
  }

  /** Copy one still-valid source, preserving vectors only for exactly identical chunk signatures. */
  public reuseSource(ref: SearchSourceRef, generation: number, signature: string): boolean {
    return this.owned(() => {
      if (!this.writable(generation)) return false;
      const source = this.sqlite
        .prepare(
          `SELECT ${SOURCE_COLUMNS} FROM search_sources WHERE id=? AND content_hash=? AND kind=? AND signature=? AND generation<>? ORDER BY generation DESC LIMIT 1`,
        )
        .get(ref.id, ref.contentHash, ref.kind, signature, generation);
      if (source === undefined) return false;
      const indexed = checked(IndexedSourceSchema, source);
      if (!this.validSource(indexed)) return false;
      if (!this.hasAllFts(indexed.generation, ref.id)) return false;
      if (!this.signature(generation, signature)) return false;
      this.removeSource(generation, ref.id);
      this.sqlite
        .prepare(
          'INSERT INTO search_sources(generation,id,kind,content_hash,revision,signature) VALUES (?,?,?,?,?,?)',
        )
        .run(generation, ref.id, ref.kind, ref.contentHash, indexed.revision, signature);
      this.copyChunks(indexed.generation, generation, ref.id);
      return true;
    });
  }

  public replaceChunks(input: SearchChunkWrite): boolean {
    return this.owned((owner) => {
      if (!this.writable(input.generation)) return false;
      const fresh = this.sourceQueries.read(owner, input.source.id);
      if (
        !fresh ||
        fresh.source.contentHash !== input.source.contentHash ||
        fresh.source.kind !== input.source.kind
      )
        return false;
      nonempty(input.signature, 500);
      if (input.chunks.length > 8192) invalid('A source has too many search chunks');
      let through = 0;
      for (const [index, chunk] of input.chunks.entries()) {
        if (
          !Number.isSafeInteger(chunk.start) ||
          !Number.isSafeInteger(chunk.end) ||
          chunk.start < 0 ||
          chunk.ordinal !== index ||
          chunk.start > through ||
          chunk.end <= chunk.start ||
          chunk.end > fresh.text.length ||
          chunk.text !== fresh.text.slice(chunk.start, chunk.end) ||
          chunk.text.length === 0 ||
          chunk.text.length > 16_000 ||
          chunk.tokens.length > 128_000 ||
          split(fresh.text, chunk.start) ||
          split(fresh.text, chunk.end)
        )
          invalid('Search chunks must cover exact persistent UTF-16 source ranges');
        through = Math.max(through, chunk.end);
      }
      if (through !== fresh.text.length && fresh.text.trim())
        invalid('Search chunks omitted persistent source text');
      if (!this.signature(input.generation, input.signature)) return false;
      const existing = this.indexedSource(input.generation, input.source.id);
      if (
        existing?.hash === input.source.contentHash &&
        existing.signature === input.signature &&
        existing.revision === fresh.revision &&
        this.hasAllFts(input.generation, input.source.id)
      )
        return true;
      this.removeSource(input.generation, input.source.id);
      this.sqlite
        .prepare(
          'INSERT INTO search_sources(generation,id,kind,content_hash,revision,signature) VALUES (?,?,?,?,?,?)',
        )
        .run(
          input.generation,
          input.source.id,
          input.source.kind,
          input.source.contentHash,
          fresh.revision,
          input.signature,
        );
      const insert = this.sqlite.prepare(
        'INSERT INTO search_chunks(generation,source_id,ordinal,start_offset,end_offset,text) VALUES (?,?,?,?,?,?)',
      );
      const fts = this.sqlite.prepare('INSERT INTO search_fts(rowid,tokens) VALUES (?,?)');
      for (const chunk of input.chunks) {
        const result = insert.run(
          input.generation,
          input.source.id,
          chunk.ordinal,
          chunk.start,
          chunk.end,
          chunk.text,
        );
        fts.run(result.lastInsertRowid, chunk.tokens);
      }
      return true;
    });
  }

  public putVectors(input: SearchVectorWrite): boolean {
    return this.owned((owner) => {
      if (!this.writable(input.generation)) return false;
      const source = this.indexedSource(input.generation, input.source.id);
      if (
        !source ||
        source.hash !== input.source.contentHash ||
        source.kind !== input.source.kind ||
        source.signature !== input.signature
      )
        return false;
      const fresh = this.sourceQueries.read(owner, input.source.id);
      if (
        !fresh ||
        fresh.source.contentHash !== input.source.contentHash ||
        fresh.revision !== source.revision
      )
        return false;
      bounded(input.dimensions, 1, 2048);
      bounded(input.vectors.length, 0, 512);
      nonempty(input.modelSignature, 500);
      const write = this.sqlite
        .prepare(`INSERT INTO search_vectors(chunk_id,model_signature,dimensions,vector) VALUES (?,?,?,?)
      ON CONFLICT(chunk_id,model_signature) DO UPDATE SET dimensions=excluded.dimensions,vector=excluded.vector`);
      const seen = new Set<number>();
      const pending: { id: number; bytes: Buffer }[] = [];
      for (const vector of input.vectors) {
        if (
          seen.has(vector.ordinal) ||
          vector.vector.length !== input.dimensions ||
          vector.vector.some((value) => !Number.isFinite(Math.fround(value))) ||
          !vector.vector.some((value) => Math.fround(value) !== 0)
        )
          invalid('Search vector dimensions or values are invalid');
        seen.add(vector.ordinal);
        const chunk: unknown = this.sqlite
          .prepare('SELECT id FROM search_chunks WHERE generation=? AND source_id=? AND ordinal=?')
          .get(input.generation, input.source.id, vector.ordinal);
        if (chunk === undefined) return false;
        const id = checked(ChunkIdRowSchema, chunk).id;
        const bytes = Buffer.alloc(input.dimensions * 4);
        vector.vector.forEach((value, offset) => bytes.writeFloatLE(value, offset * 4));
        pending.push({ id, bytes });
      }
      for (const vector of pending)
        write.run(vector.id, input.modelSignature, input.dimensions, vector.bytes);
      return true;
    });
  }

  public lexical(
    access: SearchAccess,
    input: { tokens: readonly string[]; generation?: number; limit?: number },
  ): SearchLexicalCandidate[] {
    return this.owned((owner) => {
      this.assertAccess(owner, access);
      const limit = input.limit ?? 100;
      bounded(limit, 1, 100);
      if (!input.tokens.length) return [];
      if (
        input.tokens.length > 64 ||
        input.tokens.some((token) => !token.trim() || token.length > 200)
      )
        invalid('Search terms exceed the lexical query limit');
      const match = input.tokens.map((token) => `"${token.replaceAll('"', '""')}"`).join(' AND ');
      const permitted = sourcePredicate(access);
      const rows: unknown[] = this.sqlite
        .prepare(
          `SELECT c.id AS chunkId,s.id AS sourceId,s.kind,s.content_hash AS hash,c.start_offset AS start,c.end_offset AS end,c.text,bm25(search_fts) AS rank
        FROM search_fts JOIN search_chunks c ON c.id=search_fts.rowid
        JOIN search_sources s ON s.id=c.source_id AND s.generation=c.generation
        JOIN search_facts f ON f.source_id=s.id AND f.revision=s.revision
        WHERE search_fts MATCH ? AND c.generation=? AND ${permitted.sql}
        ORDER BY rank,c.id LIMIT ?`,
        )
        .all(match, input.generation ?? this.state().active, ...permitted.params, limit);
      return rows.map((row) => {
        const value = checked(LexicalCandidateSchema, row);
        return {
          chunkId: value.chunkId,
          source: { id: value.sourceId, kind: value.kind, contentHash: value.hash },
          start: value.start,
          end: value.end,
          text: value.text,
          rank: value.rank,
        };
      });
    }, true);
  }

  public vectors(access: SearchAccess, input: VectorOptions): SearchVectorPage {
    return this.owned((owner) => {
      this.assertAccess(owner, access);
      const limit = input.limit ?? 128;
      bounded(limit, 1, 512);
      const predicate = sourcePredicate(access);
      const generation = input.generation ?? this.state().active;
      const base = `FROM search_vectors v JOIN search_chunks c ON c.id=v.chunk_id
      JOIN search_sources s ON s.id=c.source_id AND s.generation=c.generation
      JOIN search_facts f ON f.source_id=c.source_id AND f.revision=s.revision
      WHERE c.generation=? AND v.model_signature=? AND ${predicate.sql}`;
      const params = [generation, input.modelSignature, ...predicate.params];
      const rows: unknown[] = this.sqlite
        .prepare(
          `SELECT c.id AS chunkId,s.id AS sourceId,s.kind,s.content_hash AS hash,c.start_offset AS start,c.end_offset AS end,c.text,v.dimensions,v.vector
        ${base} AND c.id>? ORDER BY c.id LIMIT ?`,
        )
        .all(...params, input.after ?? 0, limit + 1);
      const items = rows.slice(0, limit).map((row) => {
        const candidate = checked(VectorCandidateSchema, row);
        const bytes = candidate.vector;
        if (!Buffer.isBuffer(bytes) || bytes.length !== candidate.dimensions * 4)
          invalid('Stored search vector bytes are invalid');
        const vector: number[] = [];
        for (let offset = 0; offset < bytes.length; offset += 4) {
          const value = bytes.readFloatLE(offset);
          if (!Number.isFinite(value)) invalid('Stored search vector contains invalid values');
          vector.push(value);
        }
        return {
          chunkId: candidate.chunkId,
          source: { id: candidate.sourceId, kind: candidate.kind, contentHash: candidate.hash },
          start: candidate.start,
          end: candidate.end,
          text: candidate.text,
          vector,
        };
      });
      return { items, next: rows.length > limit ? (items.at(-1)?.chunkId ?? null) : null };
    }, true);
  }

  public activate(generation: number, expectedWatermark: string): boolean {
    return this.owned((owner) => {
      const state = this.state();
      if (state.building !== null && state.building !== generation) return false;
      if (!this.writable(generation) || this.sourceQueries.watermark(owner) !== expectedWatermark)
        return false;
      this.ensureFts();
      const pending = this.pending(generation);
      if (pending > 0) return false;
      const stale = this.sqlite
        .prepare(
          `SELECT ${SOURCE_COLUMNS} FROM search_sources s WHERE s.generation=? AND NOT EXISTS(SELECT 1 FROM search_facts f WHERE f.source_id=s.id AND f.revision=s.revision)`,
        )
        .all(generation);
      for (const row of stale) this.removeSource(generation, checked(IndexedSourceSchema, row).id);
      this.sqlite
        .prepare('UPDATE search_generations SET watermark=? WHERE id=?')
        .run(expectedWatermark, generation);
      this.sqlite
        .prepare(
          'UPDATE search_index_state SET active_generation=?,building_generation=NULL,lexical_ready=1,error=NULL WHERE id=1',
        )
        .run(generation);
      return true;
    });
  }

  public setFailure(message: string | null): void {
    this.owned(() => {
      this.sqlite
        .prepare('UPDATE search_index_state SET error=? WHERE id=1')
        .run(message?.slice(0, 500) ?? null);
    });
  }

  /** Collect bounded inactive data, retaining one valid semantic cache while active mode differs. */
  public collectInactive(limit = 16, preserveSignature?: string): number {
    bounded(limit, 1, 16);
    if (preserveSignature !== undefined) nonempty(preserveSignature, 500);
    return this.owned(() => {
      const state = this.state();
      const active: unknown = this.sqlite
        .prepare('SELECT signature FROM search_generations WHERE id=?')
        .get(state.active);
      const activeSignature = checked(SignatureRowSchema, active).signature;
      let preserved = 0;
      if (preserveSignature !== undefined && activeSignature !== preserveSignature) {
        preserved = this.count(
          `SELECT COALESCE((SELECT g.id FROM search_generations g
          WHERE g.signature=? AND g.id<>? AND g.id IS NOT ?
          AND EXISTS(SELECT 1 FROM search_sources s JOIN search_facts f ON f.source_id=s.id AND f.revision=s.revision WHERE s.generation=g.id)
          ORDER BY g.id DESC LIMIT 1),0) AS count`,
          preserveSignature,
          state.active,
          state.building,
        );
      }
      const rows = this.sqlite
        .prepare(
          `SELECT ${SOURCE_COLUMNS} FROM search_sources s
        WHERE generation<>? AND generation IS NOT ?
        AND (generation<>? OR NOT EXISTS(SELECT 1 FROM search_facts f WHERE f.source_id=s.id AND f.revision=s.revision))
        ORDER BY generation,id LIMIT ?`,
        )
        .all(state.active, state.building, preserved, limit);
      for (const row of rows) {
        const source = checked(IndexedSourceSchema, row);
        this.removeSource(source.generation, source.id);
      }
      this.sqlite
        .prepare(
          `DELETE FROM search_generations WHERE id<>? AND id IS NOT ?
        AND NOT EXISTS(SELECT 1 FROM search_sources s WHERE s.generation=search_generations.id)`,
        )
        .run(state.active, state.building);
      return rows.length;
    });
  }

  /** Query completeness excludes UI counts; vector coverage is checked only for the requested model. */
  public queryReadiness(modelSignature?: string): SearchQueryReadiness {
    return this.owned((owner) => {
      const freshness = this.freshness(owner);
      if (modelSignature === undefined)
        return { generation: freshness.state.active, complete: freshness.complete };
      const missing = this.sqlite
        .prepare(
          `SELECT 1 FROM search_chunks c WHERE c.generation=?
        AND NOT EXISTS(SELECT 1 FROM search_vectors v WHERE v.chunk_id=c.id AND v.model_signature=?) LIMIT 1`,
        )
        .get(freshness.state.active, modelSignature);
      return {
        generation: freshness.state.active,
        complete: freshness.complete,
        vectorsComplete: missing === undefined,
      };
    }, true);
  }

  public status(modelSignature?: string): SearchIndexStatus {
    return this.owned((owner) => {
      const { state, pendingSources, lexicalReady, complete } = this.freshness(owner);
      const sourceCount = this.count(
        'SELECT COUNT(*) AS count FROM search_facts WHERE owner_user_id=?',
        owner,
      );
      const chunkCount = this.count(
        'SELECT COUNT(*) AS count FROM search_chunks c JOIN search_sources s ON s.id=c.source_id AND s.generation=c.generation JOIN search_facts f ON f.source_id=s.id AND f.revision=s.revision WHERE c.generation=?',
        state.active,
      );
      const vectorCount =
        modelSignature === undefined
          ? 0
          : this.count(
              'SELECT COUNT(*) AS count FROM search_vectors v JOIN search_chunks c ON c.id=v.chunk_id JOIN search_sources s ON s.id=c.source_id AND s.generation=c.generation JOIN search_facts f ON f.source_id=s.id AND f.revision=s.revision WHERE c.generation=? AND v.model_signature=?',
              state.active,
              modelSignature,
            );
      return {
        state: state.error !== null ? 'failed' : complete ? 'ready' : 'catching-up',
        generation: state.active,
        buildingGeneration: state.building,
        lexicalReady,
        sourceCount,
        chunkCount,
        vectorCount,
        pendingSources,
        error: state.error,
      };
    }, true);
  }

  /** Called inside the independent memory deletion transaction; retained generation bodies cannot revive. */
  public forgetMemory(id: string): void {
    const sources = this.sqlite
      .prepare('SELECT generation FROM search_sources WHERE id=?')
      .all(`memory:${id}`);
    for (const row of sources)
      this.removeSource(checked(GenerationRowSchema, row).generation, `memory:${id}`);
  }

  private copyChunks(from: number, to: number, sourceId: string): void {
    const rows = this.sqlite
      .prepare(
        `SELECT c.id,c.ordinal,c.start_offset AS start,c.end_offset AS end,c.text,search_fts.tokens
      FROM search_chunks c JOIN search_fts ON search_fts.rowid=c.id WHERE c.generation=? AND c.source_id=? ORDER BY c.ordinal`,
      )
      .all(from, sourceId);
    for (const row of rows) {
      const chunk = checked(ChunkSchema, row);
      const next = this.sqlite
        .prepare(
          'INSERT INTO search_chunks(generation,source_id,ordinal,start_offset,end_offset,text) VALUES (?,?,?,?,?,?)',
        )
        .run(to, sourceId, chunk.ordinal, chunk.start, chunk.end, chunk.text).lastInsertRowid;
      this.sqlite
        .prepare('INSERT INTO search_fts(rowid,tokens) VALUES (?,?)')
        .run(next, chunk.tokens);
      this.sqlite
        .prepare(
          'INSERT INTO search_vectors(chunk_id,model_signature,dimensions,vector) SELECT ?,model_signature,dimensions,vector FROM search_vectors WHERE chunk_id=?',
        )
        .run(next, chunk.id);
    }
  }

  private pending(generation: number): number {
    if (!this.ftsExists()) return this.count('SELECT COUNT(*) AS count FROM search_facts');
    return this.count(
      `SELECT COUNT(*) AS count FROM search_facts f LEFT JOIN search_sources s ON s.id=f.source_id AND s.generation=? WHERE s.id IS NULL OR s.revision<>f.revision
       OR EXISTS(SELECT 1 FROM search_chunks c WHERE c.generation=s.generation AND c.source_id=s.id AND NOT EXISTS(SELECT 1 FROM search_fts WHERE rowid=c.id))`,
      generation,
    );
  }

  private freshness(owner: string): IndexFreshness {
    const state = this.state();
    const raw: unknown = this.sqlite
      .prepare('SELECT watermark FROM search_generations WHERE id=?')
      .get(state.active);
    const stored = checked(WatermarkRowSchema, raw).watermark;
    const pendingSources = this.pending(state.active);
    const lexicalReady = state.lexicalReady === 1 && this.ftsExists();
    const complete =
      state.error === null &&
      stored === this.sourceQueries.watermark(owner) &&
      pendingSources === 0 &&
      state.building === null &&
      lexicalReady;
    return { state, pendingSources, lexicalReady, complete };
  }

  private owned<T>(operation: (owner: string) => T, readOnly = false): T {
    return this.transact(() => {
      const owner = this.profileOwner();
      if (!owner)
        throw new StorageError(
          'PROFILE_ACCOUNT_MISMATCH',
          'Search requires the authenticated profile owner',
        );
      return operation(owner);
    }, readOnly);
  }

  private assertAccess(owner: string, access: SearchAccess): void {
    if (owner !== access.ownerUserId)
      throw new StorageError(
        'PROFILE_ACCOUNT_MISMATCH',
        'Search scope belongs to another profile owner',
      );
  }

  private state(): State {
    return checked(
      StateSchema,
      this.sqlite.prepare(`SELECT ${STATE_COLUMNS} FROM search_index_state WHERE id=1`).get(),
    );
  }

  private writable(generation: number): boolean {
    const state = this.state();
    return state.active === generation || state.building === generation;
  }

  private signature(generation: number, signature: string): boolean {
    const row: unknown = this.sqlite
      .prepare('SELECT signature FROM search_generations WHERE id=?')
      .get(generation);
    if (row === undefined) return false;
    const value = checked(SignatureRowSchema, row);
    if (value.signature === signature) return true;
    if (value.signature !== 'unprepared') return false;
    this.sqlite
      .prepare('UPDATE search_generations SET signature=? WHERE id=?')
      .run(signature, generation);
    return true;
  }

  private indexedSource(generation: number, id: string): IndexedSource | undefined {
    const row: unknown = this.sqlite
      .prepare(`SELECT ${SOURCE_COLUMNS} FROM search_sources WHERE generation=? AND id=?`)
      .get(generation, id);
    return row === undefined ? undefined : checked(IndexedSourceSchema, row);
  }

  private validSource(source: IndexedSource): boolean {
    return (
      this.count(
        'SELECT COUNT(*) AS count FROM search_facts WHERE source_id=? AND revision=?',
        source.id,
        source.revision,
      ) > 0
    );
  }

  private removeSource(generation: number, id: string): void {
    try {
      this.sqlite
        .prepare(
          'DELETE FROM search_fts WHERE rowid IN(SELECT id FROM search_chunks WHERE generation=? AND source_id=?)',
        )
        .run(generation, id);
    } catch (error) {
      if (!ftsDamage(error)) throw error;
      this.recreateFts();
    }
    this.sqlite
      .prepare(
        'DELETE FROM search_vectors WHERE chunk_id IN(SELECT id FROM search_chunks WHERE generation=? AND source_id=?)',
      )
      .run(generation, id);
    this.sqlite
      .prepare('DELETE FROM search_chunks WHERE generation=? AND source_id=?')
      .run(generation, id);
    this.sqlite
      .prepare('DELETE FROM search_sources WHERE generation=? AND id=?')
      .run(generation, id);
  }

  private removeGeneration(generation: number): void {
    this.sqlite.prepare('UPDATE search_index_state SET building_generation=NULL WHERE id=1').run();
    const sources = this.sqlite
      .prepare(`SELECT ${SOURCE_COLUMNS} FROM search_sources WHERE generation=?`)
      .all(generation);
    for (const row of sources) this.removeSource(generation, checked(IndexedSourceSchema, row).id);
    this.sqlite.prepare('DELETE FROM search_generations WHERE id=?').run(generation);
  }

  private hasAllFts(generation: number, id: string): boolean {
    if (!this.ftsExists()) return false;
    return (
      this.count(
        `SELECT COUNT(*) AS count FROM search_chunks c WHERE c.generation=? AND c.source_id=?
      AND NOT EXISTS(SELECT 1 FROM search_fts WHERE rowid=c.id)`,
        generation,
        id,
      ) === 0
    );
  }

  private ftsExists(): boolean {
    return (
      this.sqlite
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='search_fts'")
        .get() !== undefined
    );
  }

  private ensureFts(): void {
    try {
      this.sqlite.prepare('SELECT rowid FROM search_fts LIMIT 1').get();
    } catch (error) {
      if (!ftsDamage(error)) throw error;
      this.recreateFts();
    }
  }

  private recreateFts(): void {
    this.sqlite.exec('DROP TABLE IF EXISTS search_fts');
    this.sqlite.exec(CREATE_FTS);
    this.sqlite
      .prepare('UPDATE search_index_state SET lexical_ready=0,error=NULL WHERE id=1')
      .run();
  }

  private count(sql: string, ...params: (string | number | null)[]): number {
    return checked(CountSchema, this.sqlite.prepare(sql).get(...params)).count;
  }
}

function bounded(value: number, minimum: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    invalid('Search allocation limit is invalid');
}
function nonempty(value: string, maximum: number): void {
  if (!value.trim() || value.length > maximum) invalid('Search signature is invalid');
}
function split(text: string, offset: number): boolean {
  const left = text.charCodeAt(offset - 1);
  const right = text.charCodeAt(offset);
  return left >= 0xd800 && left <= 0xdbff && right >= 0xdc00 && right <= 0xdfff;
}
function invalid(message: string): never {
  throw new StorageError('INVALID_RECORD', message);
}

function ftsDamage(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'SQLITE_CORRUPT_VTAB' ||
      (error.code === 'SQLITE_ERROR' && error.message.includes('no such table: search_fts')))
  );
}
