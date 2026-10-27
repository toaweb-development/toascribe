// seedDefaultContent(): what WordPress' wp_install_defaults() writes, in the site's language. The install runs it once,
// inside its transaction; see docs/DATAMODEL.md «Default content».
import { textSearchConfig } from '@toascribe/shared'
import type { Blocks } from '@toascribe/shared'
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'

import type { DbExecutor } from '../executor.ts'
import { writeSetting } from '../install.ts'
import { contentAuthor, content } from '../schema/content.ts'
import { comment } from '../schema/site.ts'
import { contentTerm, taxonomy, term } from '../schema/taxonomy.ts'
import { insertBuiltInTaxonomies } from '../seed.ts'
import { documentText, fromWordPress } from '@toascribe/blocks'
import type { Block } from '@toascribe/blocks'

import { parseBlockMarkup } from './blocks.ts'
import { firstCommentText, firstPostMarkup, privacyPolicyMarkup, samplePageMarkup } from './markup.ts'
import { DEFAULT_COMMENT_AUTHOR_EMAIL, defaultContentStrings } from './strings.ts'

export interface SeedDefaultContentInput {
  /**
   * The site's address, an origin such as https://example.no (PUBLIC_ORIGIN; a trailing slash is dropped). It goes
   * into the privacy policy («Vår nettstedsadresse er: …») and, with /admin/, into the sample page's dashboard link.
   */
  readonly siteUrl: string
  /** The first administrator: the author of all three items. */
  readonly adminAccountId: string
  /** The site language (setting `locale`). `nb` gets WordPress' bokmål strings, any other language the English ones. */
  readonly locale: string
}

export interface SeedDefaultContentResult {
  /** The «Ukategorisert» term, now `default_category`. */
  readonly categoryId: string
  /** «Hei, verden!» (content.short_id 1 on a new site, like WordPress' post 1). */
  readonly postId: string
  readonly commentId: string
  /** «Testside». */
  readonly samplePageId: string
  /** «Personvernerklæring», a draft, now `wp_page_for_privacy_policy`. */
  readonly privacyPolicyPageId: string
}

/** Some of the default content exists already: nothing was written. */
export class DefaultContentExistsError extends Error {
  override readonly name = 'DefaultContentExistsError'
  /** What was found, e.g. `post hei-verden`. */
  readonly existing: readonly string[]
  constructor(existing: readonly string[]) {
    super(`the default content exists already (${existing.join(', ')}); nothing was written`)
    this.existing = existing
  }
}

function siteOrigin(siteUrl: string): string {
  const trimmed = siteUrl.replace(/\/+$/, '')
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('siteUrl must be an absolute http(s) origin such as https://example.no')
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.origin !== trimmed) {
    throw new Error('siteUrl must be an absolute http(s) origin such as https://example.no, without a path')
  }
  return url.origin
}

/**
 * Writes WordPress' default content: the category «Ukategorisert» (set as `default_category`), the published post
 * «Hei, verden!» in it with one approved comment, the published page «Testside», and the draft page
 * «Personvernerklæring» (set as `wp_page_for_privacy_policy`), all by `adminAccountId`. Strings and markup are
 * WordPress 7.1.3's (strings.ts, markup.ts); the blocks are stored as WordPress' parsed-block tree (blocks.ts).
 *
 * Meant for the install transaction, which runs it once. It is not idempotent: when any of the four already exists it
 * throws DefaultContentExistsError and writes nothing. It runs in a savepoint (or its own transaction when given a
 * plain client), so a failure half-way leaves nothing behind either. It ensures the built-in taxonomies first, so it
 * does not depend on seedCore() having run. The app role can run it (DML only).
 */
export async function seedDefaultContent<TSchema extends Record<string, unknown>>(
  db: DbExecutor<TSchema>,
  input: SeedDefaultContentInput,
): Promise<SeedDefaultContentResult> {
  const siteUrl = siteOrigin(input.siteUrl)
  const { locale, adminAccountId } = input
  const strings = defaultContentStrings(locale)
  const config = textSearchConfig(locale)

  return db.transaction(async (tx) => {
    await insertBuiltInTaxonomies(tx)
    const [category] = await tx.select({ id: taxonomy.id }).from(taxonomy).where(eq(taxonomy.slug, 'category'))
    if (category === undefined) {
      throw new Error('the category taxonomy is missing')
    }

    const existing = [
      ...(
        await tx
          .select({ slug: term.slug })
          .from(term)
          .where(and(eq(term.taxonomyId, category.id), eq(term.slug, strings.categorySlug)))
      ).map((r) => `category ${r.slug}`),
      ...(
        await tx
          .select({ type: content.type, slug: content.slug })
          .from(content)
          .where(
            and(
              eq(content.locale, locale),
              isNull(content.parentId),
              or(
                and(eq(content.type, 'post'), eq(content.slug, strings.postSlug)),
                and(
                  eq(content.type, 'page'),
                  inArray(content.slug, [strings.samplePageSlug, strings.privacyPolicySlug]),
                ),
              ),
            ),
          )
      ).map((r) => `${r.type} ${r.slug}`),
    ]
    if (existing.length > 0) {
      throw new DefaultContentExistsError(existing.sort())
    }

    const [cat] = await tx
      .insert(term)
      .values({ taxonomyId: category.id, slug: strings.categorySlug, name: strings.categoryName })
      .returning({ id: term.id })

    const insertItem = async (item: {
      type: 'post' | 'page'
      slug: string
      title: string
      markup: string
      status: 'publish' | 'draft'
      commentStatus: 'open' | 'closed'
    }): Promise<string> => {
      // WordPress' markup, read as parse_blocks() reads it and turned into toascribe's blocks (M1.4): the editor can change them.
      const converted: Block[] | undefined = fromWordPress(parseBlockMarkup(item.markup))
      if (converted === undefined) {
        throw new Error(`the default content «${item.slug}» does not convert to blocks`)
      }
      const blocks = JSON.parse(JSON.stringify(converted)) as Blocks
      const [row] = await tx
        .insert(content)
        .values({
          type: item.type,
          locale,
          slug: item.slug,
          title: item.title,
          status: item.status,
          commentStatus: item.commentStatus,
          publishedAt: item.status === 'publish' ? sql`now()` : null,
          blocks,
          // The content service's formula (DATAMODEL «Full-text search»); the excerpt is empty.
          search: sql`setweight(to_tsvector(${config}::regconfig, ${item.title}), 'A')
                      || setweight(to_tsvector(${config}::regconfig, ${documentText(converted)}), 'C')`,
        })
        .returning({ id: content.id })
      if (row === undefined) {
        throw new Error('insert into content returned no row')
      }
      await tx.insert(contentAuthor).values({ contentId: row.id, accountId: adminAccountId, sort: 0 })
      return row.id
    }

    // One at a time and in WordPress' order, so short_id is 1, 2 and 3 on a new site, as the post ids are in WordPress.
    const postId = await insertItem({
      type: 'post',
      slug: strings.postSlug,
      title: strings.postTitle,
      markup: firstPostMarkup(strings),
      status: 'publish',
      commentStatus: 'open',
    })
    if (cat === undefined) {
      throw new Error('insert into term returned no row')
    }
    await tx.insert(contentTerm).values({ contentId: postId, termId: cat.id, sort: 0 })
    const [firstComment] = await tx
      .insert(comment)
      .values({
        contentId: postId,
        author: strings.commentAuthor,
        authorEmail: DEFAULT_COMMENT_AUTHOR_EMAIL,
        authorUrl: strings.commentAuthorUrl,
        type: 'comment',
        body: firstCommentText(strings),
        status: 'approved',
      })
      .returning({ id: comment.id })
    if (firstComment === undefined) {
      throw new Error('insert into comment returned no row')
    }

    const samplePageId = await insertItem({
      type: 'page',
      slug: strings.samplePageSlug,
      title: strings.samplePageTitle,
      markup: samplePageMarkup(strings, `${siteUrl}/admin/`),
      status: 'publish',
      commentStatus: 'closed',
    })
    const privacyPolicyPageId = await insertItem({
      type: 'page',
      slug: strings.privacyPolicySlug,
      title: strings.privacyPolicyTitle,
      markup: privacyPolicyMarkup(strings, siteUrl),
      status: 'draft',
      commentStatus: 'closed',
    })

    await writeSetting(tx, 'default_category', cat.id)
    await writeSetting(tx, 'wp_page_for_privacy_policy', privacyPolicyPageId)

    return { categoryId: cat.id, postId, commentId: firstComment.id, samplePageId, privacyPolicyPageId }
  })
}
