import { rows } from '../../config/pg.js';

/**
 * FULL-TEXT SEARCH service (PostgreSQL).
 * search_doc.tsv is a generated tsvector column with a GIN index, so this is the
 * textbook "indexed full-text search" requirement:
 *   websearch_to_tsquery → ts_rank_cd ranking → ts_headline snippets,
 * with a pg_trgm similarity fallback for typos ("calculater" finds "calculator").
 */
export async function search({
  q, kind = null, department = null, semester = null, availability = null, limit = 25,
} = {}) {
  const term = String(q || '').trim();
  if (!term) return { q: term, method: 'none', results: [] };

  const max = Math.min(Math.max(Number(limit) || 25, 1), 60);
  const base = `
    SELECT d.doc_id, d.kind, d.title, d.department, d.subject, d.category, d.semester,
           d.price, d.availability, d.tags, d.owner_id,
           ts_rank_cd(d.tsv, websearch_to_tsquery('english', $1))                      AS rank,
           similarity(d.title, $1)                                                     AS title_similarity,
           ts_headline('english', left(d.body, 600), websearch_to_tsquery('english', $1),
                       'MaxWords=24, MinWords=10, StartSel=<<, StopSel=>>')            AS snippet
      FROM search_doc d
     WHERE d.tsv @@ websearch_to_tsquery('english', $1)
       AND ($2::text IS NULL OR d.kind = $2)
       AND ($3::text IS NULL OR d.department = $3)
       AND ($4::int  IS NULL OR d.semester = $4)
       AND ($5::text IS NULL OR d.availability = $5)
     ORDER BY rank DESC, title_similarity DESC, d.updated_at DESC
     LIMIT $6`;

  const params = [term, kind, department, semester ? Number(semester) : null, availability, max];
  let data = await rows(base, params, 'fts-search');
  let method = 'fts';

  if (!data.length) {
    // pg_trgm fuzzy fallback — helps with typos in a live demo.
    data = await rows(
      `SELECT d.doc_id, d.kind, d.title, d.department, d.subject, d.category, d.semester,
              d.price, d.availability, d.tags, d.owner_id,
              similarity(d.title, $1)          AS rank,
              similarity(d.title, $1)          AS title_similarity,
              left(d.body, 240)                AS snippet
         FROM search_doc d
        WHERE (d.title % $1 OR d.title ILIKE '%' || $1 || '%' OR d.tag_text % $1)
          AND ($2::text IS NULL OR d.kind = $2)
          AND ($3::text IS NULL OR d.department = $3)
          AND ($4::int  IS NULL OR d.semester = $4)
          AND ($5::text IS NULL OR d.availability = $5)
        ORDER BY title_similarity DESC
        LIMIT $6`,
      params, 'trigram-search'
    );
    method = data.length ? 'trigram' : 'none';
  }

  return {
    q: term,
    method,
    count: data.length,
    results: data.map((r) => ({
      ...r,
      price: r.price === null ? null : Number(r.price),
      rank: r.rank === null ? 0 : Number(r.rank),
      titleSimilarity: r.title_similarity === null ? 0 : Number(r.title_similarity),
      snippet: (r.snippet || '').replace(/<</g, '<mark>').replace(/>>/g, '</mark>'),
    })),
  };
}

/** Cheap suggestion endpoint for the topbar (prefix + trigram). */
export async function suggest(term, limit = 6) {
  const t = String(term || '').trim();
  if (t.length < 2) return [];
  const data = await rows(
    `SELECT title, kind, doc_id, similarity(title, $1) AS sim
       FROM search_doc
      WHERE title ILIKE $1 || '%' OR title % $1
      ORDER BY sim DESC, title
      LIMIT $2`, [t, Math.min(Number(limit) || 6, 20)], 'suggest'
  );
  return data.map((r) => ({ title: r.title, kind: r.kind, id: r.doc_id, similarity: Number(r.sim) }));
}
