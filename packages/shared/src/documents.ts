import { z } from 'zod'

// Shapes of the JSONB columns of the data model. @toascribe/db types each column with the inferred type
// (`jsonb(...).$type<T>()`), and the API validates writes with the schema. Most are placeholders until the feature
// that owns the shape is built (the milestone is named on each); where PLAN already names the keys, the schema has them.
// A placeholder is an open record, so tightening it later is a change to this file only, never to the table.

/** Any JSON value (setting.value, audit_log.old_value and new_value). */
export const JsonValue = z.json()
export type JsonValue = z.infer<typeof JsonValue>

/** An open JSON object: the placeholder for shapes that are not specified yet. */
export const JsonObject = z.record(z.string(), z.json())
export type JsonObject = z.infer<typeof JsonObject>

/** One node of a block tree (content.blocks and every other `blocks` column). The block format comes in M0.6 and M1.3. */
export const BlockNode = JsonObject
export type BlockNode = JsonObject

/** A block tree: the top-level blocks in order. Empty content is `[]`. */
export const Blocks = z.array(BlockNode)
export type Blocks = z.infer<typeof Blocks>

/** content.fields: custom field values, validated against the content type's schema (K-093, phase 2). */
export const ContentFields = JsonObject
export type ContentFields = JsonObject

/** content.seo (K-105). `image` is a media id, not a URL, so a domain change needs no search and replace. */
export const ContentSeo = z
  .object({
    title: z.string(),
    description: z.string(),
    image: z.uuid(),
    noindex: z.boolean(),
  })
  .partial()
export type ContentSeo = z.infer<typeof ContentSeo>

/**
 * The editable state of one content item as JSON: what content_draft, content_autosave and content_revision store
 * (title, excerpt, slug, blocks, fields, seo, ...). Specified with revisions and autosave (K-072 to K-074, phase 2).
 */
export const ContentSnapshot = JsonObject
export type ContentSnapshot = JsonObject

/** content_type.schema: labels, supports and field schema of a content type made in admin (K-094, phase 2). */
export const ContentTypeSchema = JsonObject
export type ContentTypeSchema = JsonObject

/** field_group.schema: the fields and the location rules of a field group (K-093, phase 2). */
export const FieldGroupSchema = JsonObject
export type FieldGroupSchema = JsonObject

/** account.profile (K-011, K-012, K-015): first and last name, nickname, website, biography, pending e-mail, avatar. */
export const AccountProfile = JsonObject
export type AccountProfile = JsonObject

/** account.preferences (K-032 to K-040): admin colour scheme, toolbar, screen options, dismissed notices, dashboard. */
export const AccountPreferences = JsonObject
export type AccountPreferences = JsonObject

/** mfa_credential.data: passkey public key and counter, OIDC claims, TOTP replay step. Specified in M0.3 and phase 2. */
export const MfaCredentialData = JsonObject
export type MfaCredentialData = JsonObject

/** media.focal_point (K-118): the point every crop keeps, as fractions of the width and height from the top left. */
export const FocalPoint = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
})
export type FocalPoint = z.infer<typeof FocalPoint>

/** media.variants (K-111): generated sizes and formats, keyed by size name. Specified with the media pipeline (M1.2). */
export const MediaVariants = JsonObject
export type MediaVariants = JsonObject

/** menu.items (K-132): the menu as one JSON tree of links to content, terms or URLs (M1.5). */
export const MenuItems = z.array(JsonObject)
export type MenuItems = z.infer<typeof MenuItems>

/** global_set.fields (K-106): the values of a global set (M1.5). */
export const GlobalSetFields = JsonObject
export type GlobalSetFields = JsonObject

/** oembed_cache.data (K-225): the provider's oEmbed response. */
export const OembedData = JsonObject
export type OembedData = JsonObject

/** webhook_delivery.payload (K-177): the event body that was signed and sent. */
export const WebhookPayload = JsonObject
export type WebhookPayload = JsonObject

/** workflow.steps (K-097, phase 3): the ordered steps; content.workflow_state holds a step key. */
export const WorkflowSteps = z.array(JsonObject)
export type WorkflowSteps = z.infer<typeof WorkflowSteps>

/** extension_state.settings (K-150, K-166): a theme's or plugin's settings, validated by its own schema. */
export const ExtensionSettings = JsonObject
export type ExtensionSettings = JsonObject
