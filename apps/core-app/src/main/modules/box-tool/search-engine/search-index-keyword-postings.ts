import type { SQL } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import type { SearchIndexWriteTx } from './search-index-document-store'

/**
 * Keyword postings: one row per (provider, keyword, document), keyed by an integer document id.
 *
 * `keyword_mappings` repeated the item id — for a file, its whole path, 108 bytes on average — in
 * every row and again in two of its indexes, and on 2026-10-20 it took 93% of a names-only index.
 * Here the item id is stored once, in `search_index_meta`, which owns `doc_id`. The FTS rowid
 * cannot serve as that id: every rewrite of a document deletes and re-inserts its FTS row.
 *
 * `keyword_mappings` remains as the legacy layout while it drains. The keyword delta moves a
 * document whole when it rewrites it; `moveLegacyKeywords` moves the rest in maintenance slices,
 * by row rather than by document, so until its last row moves a document can have keywords in
 * both layouts — each row in one or the other. Reads take both layouts in one statement, so a
 * reader sees each row once, from whichever layout holds it.
 */

const PRIORITY_EPSILON = 0.0001
const INSERT_CHUNK_ROWS = 200
/** Progress rows of the current pass of `moveLegacyKeywords`; a reset of the index forgets them. */
export const LEGACY_MOVE_TASKS = {
  lastDocId: 'legacy-keyword-move:doc-id',
  lastRowId: 'legacy-keyword-move:row-id'
} as const

export interface KeywordPostingsDocument {
  providerId: string
  itemId: string
  docId: number
}

function sqlList(values: readonly (string | number)[]): SQL {
  return sql.join(
    values.map((value) => sql`${value}`),
    sql`, `
  )
}

/**
 * The next document id: one past the largest still referenced by meta or by postings, so an id
 * never comes back while a row could point at it. The write transaction serialises allocation.
 */
export async function allocateKeywordDocId(tx: SearchIndexWriteTx): Promise<number> {
  const rows = await tx.all<{ next: number }>(sql`SELECT max(
      coalesce((SELECT max(doc_id) FROM search_index_meta WHERE doc_id IS NOT NULL), 0),
      coalesce((SELECT max(doc_id) FROM search_keyword_postings), 0)
    ) + 1 AS next`)
  const next = Number(rows[0]?.next)
  if (!Number.isSafeInteger(next) || next <= 0) throw new Error('SEARCH_KEYWORD_DOC_ID_UNAVAILABLE')
  return next
}

type PostingRow = readonly [providerId: string, keyword: string, docId: number, priority: number]

/** `priority` names the stored row's priority, `excluded.priority` the incoming one. */
async function insertPostings(
  tx: SearchIndexWriteTx,
  rows: readonly PostingRow[],
  priorityOnConflict: SQL
): Promise<void> {
  for (let start = 0; start < rows.length; start += INSERT_CHUNK_ROWS) {
    const values = rows
      .slice(start, start + INSERT_CHUNK_ROWS)
      .map(
        ([providerId, keyword, docId, priority]) =>
          sql`(${providerId}, ${keyword}, ${docId}, ${priority})`
      )
    await tx.run(sql`INSERT INTO search_keyword_postings (provider_id, keyword, doc_id, priority)
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT(provider_id, keyword, doc_id) DO UPDATE SET priority = ${priorityOnConflict}`)
  }
}

async function upsertPostings(
  tx: SearchIndexWriteTx,
  document: KeywordPostingsDocument,
  entries: ReadonlyArray<readonly [string, number]>
): Promise<void> {
  await insertPostings(
    tx,
    entries.map(([keyword, priority]) => [document.providerId, keyword, document.docId, priority]),
    sql`excluded.priority`
  )
}

/**
 * Brings a document's postings to `next` (keyword -> priority, already normalised). A document
 * still in the legacy layout moves whole; its old rows go first, so an index at its size cap has
 * the freed pages for the new ones.
 */
export async function writeKeywordPostings(
  tx: SearchIndexWriteTx,
  document: KeywordPostingsDocument,
  next: ReadonlyMap<string, number>
): Promise<void> {
  const legacy = await tx.run(sql`DELETE FROM keyword_mappings
    WHERE provider_id = ${document.providerId} AND item_id = ${document.itemId}`)
  if (Number(legacy.rowsAffected) > 0) {
    await tx.run(sql`DELETE FROM search_keyword_postings WHERE doc_id = ${document.docId}`)
    await upsertPostings(tx, document, [...next])
    return
  }

  const rows = await tx.all<{ keyword: string; priority: number }>(sql`
    SELECT keyword, priority FROM search_keyword_postings WHERE doc_id = ${document.docId}
  `)
  const removed: string[] = []
  for (const row of rows) {
    if (!next.has(row.keyword)) removed.push(row.keyword)
  }
  const current = new Map(rows.map((row) => [row.keyword, Number(row.priority)]))
  const changed = [...next].filter(([keyword, priority]) => {
    const previous = current.get(keyword)
    return previous === undefined || Math.abs(previous - priority) > PRIORITY_EPSILON
  })
  if (removed.length > 0) {
    await tx.run(sql`DELETE FROM search_keyword_postings
      WHERE provider_id = ${document.providerId} AND doc_id = ${document.docId}
        AND keyword IN (${sqlList(removed)})`)
  }
  await upsertPostings(tx, document, changed)
}

/** Postings of the given documents; callers delete them before the meta rows that own the ids. */
export async function deleteKeywordPostings(
  tx: SearchIndexWriteTx,
  docIds: readonly number[]
): Promise<void> {
  if (docIds.length === 0) return
  await tx.run(sql`DELETE FROM search_keyword_postings WHERE doc_id IN (${sqlList(docIds)})`)
}

export async function deleteProviderKeywordPostings(
  tx: SearchIndexWriteTx,
  providerId: string
): Promise<void> {
  await tx.run(sql`DELETE FROM search_keyword_postings WHERE provider_id = ${providerId}`)
}

interface LegacyMovePass {
  /** The largest doc id when the pass began: a document at or below it has no rows moved yet. */
  lastDocId: number
  /** The largest legacy row id when the pass began; the pass moves no row past it. */
  lastRowId: number
}

async function readLegacyMovePass(tx: SearchIndexWriteTx): Promise<LegacyMovePass | null> {
  const rows = await tx.all<{ task: string; cursor: number }>(sql`
    SELECT task, cursor FROM search_index_maintenance_progress
    WHERE task IN (${LEGACY_MOVE_TASKS.lastDocId}, ${LEGACY_MOVE_TASKS.lastRowId})
  `)
  const cursor = (task: string): number | undefined => {
    const row = rows.find((candidate) => candidate.task === task)
    return row === undefined ? undefined : Number(row.cursor)
  }
  const lastDocId = cursor(LEGACY_MOVE_TASKS.lastDocId)
  const lastRowId = cursor(LEGACY_MOVE_TASKS.lastRowId)
  return lastDocId === undefined || lastRowId === undefined ? null : { lastDocId, lastRowId }
}

async function readLegacyRows(
  tx: SearchIndexWriteTx,
  pass: LegacyMovePass,
  rowLimit: number
): Promise<
  Array<{ id: number; providerId: string; itemId: string; keyword: string; priority: number }>
> {
  return await tx.all(sql`
    SELECT id, provider_id AS providerId, item_id AS itemId, keyword, priority
    FROM keyword_mappings WHERE id <= ${pass.lastRowId} ORDER BY id LIMIT ${rowLimit}
  `)
}

/**
 * Moves the oldest legacy rows, up to `rowLimit`, into postings; 0 means the legacy table is
 * empty. By row rather than by document: a document's rows can lie anywhere in the table, and at
 * the size cap only neighbouring rows free whole pages — deleted first, those pages take the
 * postings. Rows whose document has no meta row are orphans and are dropped; callers run this only
 * once every FTS document has a meta row.
 *
 * Legacy rows replace any postings of the same document: only an older build writes them, so after
 * a downgrade and upgrade they are the newer copy. As a document's rows can span slices, a pass
 * records the largest doc id when it began; the first rows of a document at or below it replace
 * its postings and give it a new id, and its later rows add to that. A pass moves only the rows
 * that existed when it began, so rows an older build writes meanwhile wait for the next.
 */
export async function moveLegacyKeywords(
  tx: SearchIndexWriteTx,
  rowLimit: number
): Promise<{ rows: number; orphansByProvider: Map<string, number> }> {
  const orphansByProvider = new Map<string, number>()
  let pass = await readLegacyMovePass(tx)
  let rows = pass === null ? [] : await readLegacyRows(tx, pass, rowLimit)
  let begun = false
  if (pass === null || rows.length === 0) {
    const last = await tx.all<{ id: number | null }>(
      sql`SELECT max(id) AS id FROM keyword_mappings`
    )
    if (last[0]?.id === null || last[0]?.id === undefined) {
      if (pass !== null) {
        await tx.run(sql`DELETE FROM search_index_maintenance_progress
          WHERE task IN (${LEGACY_MOVE_TASKS.lastDocId}, ${LEGACY_MOVE_TASKS.lastRowId})`)
      }
      return { rows: 0, orphansByProvider }
    }
    pass = { lastDocId: (await allocateKeywordDocId(tx)) - 1, lastRowId: Number(last[0].id) }
    rows = await readLegacyRows(tx, pass, rowLimit)
    begun = true
  }

  await tx.run(sql`DELETE FROM keyword_mappings WHERE id <= ${rows[rows.length - 1].id}`)
  if (begun) {
    await tx.run(sql`INSERT INTO search_index_maintenance_progress(task, cursor)
      VALUES (${LEGACY_MOVE_TASKS.lastDocId}, ${pass.lastDocId}),
             (${LEGACY_MOVE_TASKS.lastRowId}, ${pass.lastRowId})
      ON CONFLICT(task) DO UPDATE SET cursor = excluded.cursor`)
  }

  const documents = new Map<
    string,
    { providerId: string; itemId: string; keywords: Map<string, number> }
  >()
  for (const row of rows) {
    const key = JSON.stringify([row.providerId, row.itemId])
    let document = documents.get(key)
    if (document === undefined) {
      document = { providerId: row.providerId, itemId: row.itemId, keywords: new Map() }
      documents.set(key, document)
    }
    const priority = Number(row.priority)
    const previous = document.keywords.get(row.keyword)
    if (previous === undefined || priority > previous) document.keywords.set(row.keyword, priority)
  }

  const replaced: number[] = []
  const assigned: KeywordPostingsDocument[] = []
  const moved: PostingRow[] = []
  let nextDocId: number | null = null
  for (const { providerId, itemId, keywords } of documents.values()) {
    const meta = await tx.all<{ docId: number | null }>(sql`
      SELECT doc_id AS docId FROM search_index_meta
      WHERE provider_id = ${providerId} AND item_id = ${itemId}
    `)
    if (meta.length === 0) {
      const rest = await tx.all(sql`SELECT 1 FROM keyword_mappings
        WHERE provider_id = ${providerId} AND item_id = ${itemId} LIMIT 1`)
      // Counted with a document's last rows. Rows from before provider ids existed carry '' and
      // belong to no source to notify.
      if (rest.length === 0 && providerId)
        orphansByProvider.set(providerId, (orphansByProvider.get(providerId) ?? 0) + 1)
      continue
    }
    let docId = meta[0].docId === null ? null : Number(meta[0].docId)
    if (docId === null || docId <= pass.lastDocId) {
      if (docId !== null) replaced.push(docId)
      nextDocId ??= await allocateKeywordDocId(tx)
      docId = nextDocId++
      assigned.push({ providerId, itemId, docId })
    }
    for (const [keyword, priority] of keywords) moved.push([providerId, keyword, docId, priority])
  }

  await deleteKeywordPostings(tx, replaced)
  for (const { providerId, itemId, docId } of assigned) {
    await tx.run(sql`UPDATE search_index_meta SET doc_id = ${docId}
      WHERE provider_id = ${providerId} AND item_id = ${itemId}`)
  }
  // A keyword the legacy table holds twice for a document can reach postings in two slices.
  await insertPostings(tx, moved, sql`max(priority, excluded.priority)`)
  return { rows: rows.length, orphansByProvider }
}

/**
 * Keyword rows as `(provider_id, keyword, item_id, priority)` from both layouts. SQLite flattens
 * the compound, so each arm keeps its own index for the caller's predicates: the postings key for
 * the keyword, the meta `doc_id` index for the item id.
 */
export function keywordRowsSource(): SQL {
  return sql`(
    SELECT p.provider_id AS provider_id, p.keyword AS keyword, m.item_id AS item_id,
           p.priority AS priority
    FROM search_keyword_postings p
    JOIN search_index_meta m ON m.doc_id = p.doc_id AND m.provider_id = p.provider_id
    UNION ALL
    SELECT provider_id, keyword, item_id, priority FROM keyword_mappings
  )`
}
