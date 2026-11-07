/**
 * Overlay data model.
 *
 * Loosely follows the W3C Web Annotation Data Model (TextQuoteSelector /
 * TextPositionSelector) so that annotations can be re-anchored even after the
 * target document changes. The original document is never modified: all
 * review data lives in a separate "overlay file" (*.overlay.json).
 */

export const OVERLAY_FORMAT_VERSION = 1 as const

/** Exact text plus surrounding context. Robust against moves. */
export interface TextQuoteSelector {
  type: 'TextQuoteSelector'
  exact: string
  prefix: string
  suffix: string
}

/** Character offsets into the document's normalized text. Fast but brittle. */
export interface TextPositionSelector {
  type: 'TextPositionSelector'
  start: number
  end: number
}

export type Selector = TextQuoteSelector | TextPositionSelector

export interface AnnotationTarget {
  selectors: Selector[]
  /** Fingerprint of the document text at the time the annotation was made. */
  fingerprint: string
}

export type AnnotationKind = 'comment' | 'suggestion'

export interface Author {
  name: string
  kind: 'human' | 'ai'
  /** e.g. "codex", "openai:gpt-5" for AI authors */
  via?: string
}

export interface Reply {
  id: string
  author: Author
  text: string
  createdAt: string
}

export interface Annotation {
  id: string
  target: AnnotationTarget
  kind: AnnotationKind
  /** Review comment (Markdown allowed). */
  text: string
  /** For kind === 'suggestion': proposed replacement for the quoted text. */
  suggestion?: string
  severity?: 'info' | 'minor' | 'major'
  author: Author
  status: 'open' | 'resolved'
  /** AI generated annotations start as drafts until a human accepts them. */
  draft?: boolean
  replies: Reply[]
  createdAt: string
  updatedAt: string
}

export type DocumentSourceType = 'markdown' | 'html' | 'url'

export interface DocumentRef {
  type: DocumentSourceType
  /** Relative path (for files) or absolute URL. */
  source: string
  title?: string
  /** Fingerprint of the document when this overlay file was last saved. */
  fingerprint?: string
}

/** The shareable unit: one overlay file per reviewed document. */
export interface OverlayFile {
  $schema?: string
  version: typeof OVERLAY_FORMAT_VERSION
  document: DocumentRef
  annotations: Annotation[]
}

/**
 * Result of re-anchoring an annotation against the current document text.
 *  - exact:    found at the recorded position with matching context
 *  - moved:    exact text found elsewhere (document was edited around it)
 *  - fuzzy:    similar text found; the quoted text itself was changed
 *  - orphaned: could not be located – kept and listed separately
 */
export type AnchorStatus = 'exact' | 'moved' | 'fuzzy' | 'orphaned'

export interface AnchorResult {
  status: AnchorStatus
  start: number
  end: number
  /** 0..1 similarity of the matched text to the original quote. */
  score: number
}
