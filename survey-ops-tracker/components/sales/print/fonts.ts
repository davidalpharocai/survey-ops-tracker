import { Source_Serif_4, Source_Sans_3 } from 'next/font/google'

/**
 * The two faces of the client documents.
 *
 * Source Serif 4 for the figures and the client's name, Source Sans 3 for
 * everything else: a statement typeface pairing that holds its shape at 6.5pt
 * and prints cleanly in greyscale. Self-hosted by next/font, so the PDF never
 * depends on a third-party font request succeeding at print time.
 *
 * `display: 'block'`, not 'swap': a print that fires before the face loads
 * would bake the fallback into the PDF. usePrintWhenReady also waits for
 * document.fonts.ready, and 'block' makes that wait mean something.
 */
export const serif = Source_Serif_4({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  display: 'block',
  variable: '--font-st-serif',
})

export const sans = Source_Sans_3({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  style: ['normal', 'italic'],
  display: 'block',
  variable: '--font-st-sans',
})
