import { describe, expect, it } from 'vitest'

import { createBlock, documentText } from '../src/index.ts'
import { MEDIA_ID, col, cols, img, p, text } from './fixtures.ts'

describe('documentText', () => {
  it('takes the text of paragraphs and the alt text and caption of an image, in order, also inside columns', () => {
    const caption = createBlock(
      'core/image',
      { mediaId: MEDIA_ID, alt: 'Fjord', caption: 'Ved  Geiranger' },
      [],
      'b_img00002',
    )
    const document = [
      p('b_p0000001', 'Første avsnitt'),
      cols('b_cols0001', col('b_col00001', p('b_p0000002', 'Venstre')), col('b_col00002', caption)),
      img('b_img00001'),
    ]
    expect(documentText(document)).toBe('Første avsnitt Venstre Fjord Ved Geiranger An image')
  })

  it('leaves out the media id, empty text and the marks of rich text', () => {
    const bold = createBlock(
      'core/paragraph',
      { content: [...text('fet', [{ type: 'bold' }]), { type: 'hardBreak' }, ...text('tekst')] },
      [],
      'b_p0000003',
    )
    expect(documentText([bold, p('b_p0000004'), img('b_img00003')])).toBe('fet tekst An image')
    expect(documentText([])).toBe('')
  })
})
