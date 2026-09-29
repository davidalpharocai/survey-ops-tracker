import { cssString } from '@/lib/sales/statement'

/**
 * The stylesheet for both client documents, as one string.
 *
 * WHY A STRING IN A <style> TAG, NOT globals.css. These rules are about two
 * pages. An @page rule in the global sheet would change how every other screen
 * in the app prints, and the page-margin boxes below carry the client's name,
 * which changes per render. The component writes this with
 * dangerouslySetInnerHTML rather than as {children}, so React cannot
 * entity-escape the quotes inside `content:` strings (view-source should show
 * `content:"AlphaROC`, not `content:&quot;AlphaROC`).
 *
 * WHY HEX HERE when the app uses tokens: this is PAPER. It prints the same ink
 * whatever theme the reader's app is in, and `print-color-adjust: exact` makes
 * the printer honour it. The on-screen checklist above the paper is app UI and
 * uses the app's tokens.
 *
 * The rules were proven in headless Chrome and in the Windows PDF engine
 * before they were ported (see the page-break and margin-box notes inline):
 * the statement is two Letter pages for a 15-survey account and the list one.
 */
export function statementCss({ footerLeft, footerRight, footerFont }: {
  /** Page-footer text, left: "AlphaROC · Confidential · Prepared for …". */
  footerLeft: string
  /** Page-footer text, right, before the counters: "Survey List · 24 September 2026 · Page ". */
  footerRight: string
  /** The sans family as next/font names it. Margin boxes do not inherit the
   *  document's CSS variables, so the literal family has to be written in. */
  footerFont: string
}): string {
  const foot = `font:400 6.5pt/1.2 ${footerFont}, "Source Sans 3", Arial, sans-serif;color:#5B6472;vertical-align:top;padding-top:5mm`
  return `
/* ── Ink scale (AlphaROC navy family) ─────────────────────────────────────── */
.st, .st-sheet{
  --st-navy:#010B40; --st-teal:#0076AF; --st-ink-2:#2A3550; --st-ink-3:#5B6472;
  --st-ink-4:#8A93A3; --st-rule:#C2CAD8; --st-rule-2:#E7EBF1; --st-fill:#F4F6FA;
  --st-serif: var(--font-st-serif, "Source Serif 4"), Georgia, "Times New Roman", serif;
  --st-sans: var(--font-st-sans, "Source Sans 3"), "Segoe UI", "Helvetica Neue", Arial, sans-serif;
  color-scheme: light;
}

/* ── On screen: paper on the desk ─────────────────────────────────────────── */
.st-sheet{width:210mm;max-width:100%;box-sizing:border-box;margin:0 auto;background:#fff;padding:16mm 16mm 19mm;
  box-shadow:0 1px 2px rgba(1,11,64,.06),0 12px 32px rgba(1,11,64,.10)}

/* ── The document ────────────────────────────────────────────────────────── */
.st{font-family:var(--st-sans);font-size:8pt;line-height:1.32;color:var(--st-navy);
  font-variant-numeric:lining-nums tabular-nums;font-kerning:normal;hyphens:manual;-webkit-font-smoothing:antialiased}
.st *{box-sizing:border-box}
.st p{margin:0}

/* Masthead. */
.st-mast{margin:0 0 5.5mm}
.st-internal{border:1pt solid var(--st-navy);border-left-width:3.5pt;padding:1.4mm 2.4mm;margin:0 0 4mm;
  font-size:7pt;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--st-navy)}
.st-mast-top{display:flex;justify-content:space-between;align-items:flex-end;gap:8mm;
  padding-bottom:3mm;border-bottom:1.2pt solid var(--st-navy)}
/* A plain <img> of the navy wordmark (868x268). A CSS mask exports as a
   soft-mask group that Windows' PDF engine paints as a solid navy block; an
   image is an image in every viewer. */
.st-logo{display:block;width:26mm;height:auto}
.st-doctitle{font-family:var(--st-serif);font-size:14pt;line-height:1;font-weight:400;color:var(--st-navy);
  text-align:right;letter-spacing:.003em;padding-bottom:.4mm}
.st-mast-body{display:grid;grid-template-columns:1fr auto;gap:10mm;align-items:end;padding-top:4.2mm}
.st-label{font-size:6.3pt;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--st-ink-3)}
.st-client{font-family:var(--st-serif);font-size:23pt;line-height:1.04;font-weight:600;color:var(--st-navy);
  margin-top:1.3mm;letter-spacing:-.006em;overflow-wrap:anywhere}
.st-client-sm{font-size:17pt}
.st-meta{display:grid;grid-template-columns:auto auto;column-gap:4.5mm;row-gap:.7mm;margin:0;font-size:7.4pt;line-height:1.3}
.st-meta dt{color:var(--st-ink-3)}
.st-meta dd{margin:0;color:var(--st-navy)}
.st-meta dd.st-strong{font-weight:600}

/* Section heads: label, hairline, aside. */
.st-sec{display:flex;align-items:baseline;gap:2.6mm;margin:0 0 2mm;break-after:avoid}
.st-sec h2{margin:0;font-size:6.5pt;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--st-teal);white-space:nowrap}
.st-sec-rule{flex:1;border-bottom:.5pt solid var(--st-rule);transform:translateY(-1.3pt)}
.st-sec-aside{font-size:7pt;color:var(--st-ink-3);white-space:nowrap}
.st-sec-aside.st-wrap{white-space:normal;text-align:right;max-width:70%}

/* Summary: two clusters, each owning its own scope. */
.st-summary{display:grid;grid-template-columns:1fr 1fr;column-gap:9mm;margin:0 0 6.5mm;break-inside:avoid}
/* One panel chosen (printColumns): its heading rule runs the full width, and
   its figures and meter keep the proportions they have beside the other panel
   rather than stretching across the page. */
.st-summary-one{grid-template-columns:1fr}
.st-summary-one .st-figs,.st-summary-one .st-meter{max-width:calc(50% - 4.5mm)}
.st-cluster-head{display:flex;justify-content:space-between;align-items:baseline;gap:3mm;
  border-bottom:.75pt solid var(--st-navy);padding-bottom:1.3mm;margin-bottom:2.8mm}
.st-cluster-head b{font-size:6.5pt;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--st-teal);white-space:nowrap}
.st-cluster-head span{font-size:7pt;color:var(--st-ink-3);text-align:right}
.st-figs{display:grid;grid-template-columns:1.1fr 1fr;column-gap:5mm}
.st-fig-label{font-size:6.4pt;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--st-ink-3)}
.st-fig-num{font-family:var(--st-serif);font-size:25pt;line-height:1.02;font-weight:400;color:var(--st-navy);
  margin:.9mm 0 1mm;letter-spacing:-.012em;font-variant-numeric:lining-nums tabular-nums;white-space:nowrap}
.st-fig-word{font-size:15pt;line-height:1.5;white-space:normal}
/* "at least" / "at most" sits ON the figure, so no reading of it can drop it. */
.st-q{font-family:var(--st-sans);font-size:7pt;font-weight:600;letter-spacing:.02em;color:var(--st-ink-3);margin-right:1.2mm;vertical-align:.35em}
.st-fig-cap{font-size:7pt;line-height:1.32;color:var(--st-ink-3)}
.st-fig-cap b{font-weight:600;color:var(--st-navy)}
.st-fn{font-family:var(--st-sans);font-size:.72em;font-weight:700;color:var(--st-teal);vertical-align:super;line-height:0;margin-left:.3mm;font-style:normal}
.st-fig-num .st-fn{font-size:6.5pt;vertical-align:top;position:relative;top:1.2mm;margin-left:.6mm}
.st-below{display:inline-block;width:4.6pt;height:3.5pt;margin-right:.9mm;vertical-align:.1em}
.st-below-i{margin-right:0;vertical-align:.05em}

/* Meter: credits drawn and term elapsed on ONE scale, sharing the allowance
   rule. Plain SVG geometry: rects, explicit hatch lines clipped by a nested
   <svg>, one rule. No gradient, pattern or mask, so every PDF viewer and every
   greyscale printer draws the same thing. */
.st-meter{display:grid;grid-template-columns:auto 1fr auto;column-gap:2.2mm;row-gap:1.1mm;align-items:center;margin-top:3.4mm}
.st-m-l{font-size:6.5pt;color:var(--st-ink-3);white-space:nowrap}
.st-m-v{font-size:6.8pt;font-weight:600;color:var(--st-navy);text-align:right;white-space:nowrap;min-width:10mm}
.st-m-bar{display:block;width:100%;height:9px;overflow:visible}
.st-m-term{height:7px}
.st-m-axis{position:relative;height:2.6mm;font-size:6.2pt;color:var(--st-ink-3)}
.st-m-axis span{position:absolute;top:0;white-space:nowrap}
.st-m-cap{transform:translateX(-50%)}

/* Period line, only when a date range is set. */
.st-period{margin-top:2.6mm;padding-top:1.6mm;border-top:.5pt solid var(--st-rule);font-size:7.2pt;color:var(--st-navy)}
.st-period b{display:block;font-size:6.4pt;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--st-ink-3);margin-bottom:.4mm}

/* Status key: the legend for the ledger's marks. */
.st-key{display:flex;flex-wrap:wrap;gap:1mm 4mm;margin-top:3.4mm;padding-top:1.6mm;border-top:.5pt solid var(--st-rule);font-size:6.6pt;color:var(--st-ink-3)}
.st-key span{position:relative;padding-left:3.1mm;white-space:nowrap}
.st-key .st-dot{top:.15em}

/* Survey-list figure strip: one row, one scope. */
.st-strip{display:grid;grid-template-columns:repeat(3,1fr);border-top:.75pt solid var(--st-navy);
  border-bottom:.5pt solid var(--st-rule);margin:0 0 5.5mm;break-inside:avoid}
/* Fewer tiles when a column is off: the row still fills the width rather than
   leaving an empty third where the credits used to be. */
.st-strip-2{grid-template-columns:repeat(2,1fr)}
.st-strip-1{grid-template-columns:1fr}
.st-strip > div{padding:2.4mm 4mm 2.6mm}
.st-strip > div:first-child{padding-left:0}
.st-strip > div + div{border-left:.5pt solid var(--st-rule)}
.st-strip .st-fig-num{font-size:19pt}

/* The ledger. 'separate' rather than 'collapse': with collapsed borders Chrome
   resolves a REPEATED header's rule against the next row, and page 2 onward
   loses the navy line under the column heads. */
.st-scroll{overflow-x:auto}
.st-ledger{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed;min-width:150mm}
.st-ledger col.c-ref{width:14.5mm}
.st-ledger col.c-acct{width:19mm}
.st-ledger col.c-req{width:22mm}
.st-ledger col.c-status{width:26mm}
.st-ledger col.c-tgt{width:12.5mm}
.st-ledger col.c-fin{width:12mm}
.st-ledger col.c-cr{width:18mm}
.st-ledger th,.st-ledger td{padding:.95mm 1.3mm;vertical-align:top;text-align:left}
.st-ledger th:first-child,.st-ledger td:first-child{padding-left:0}
.st-ledger th:last-child,.st-ledger td:last-child{padding-right:0}
.st-ledger thead th{font-size:6.8pt;font-weight:600;color:var(--st-ink-3);vertical-align:bottom;
  padding-top:0;padding-bottom:1.1mm;border-bottom:.75pt solid var(--st-navy);line-height:1.15}
.st-ledger thead tr:first-child th.st-span{text-align:center;padding-bottom:.7mm;border-bottom:.5pt solid var(--st-rule);
  letter-spacing:.1em;text-transform:uppercase;font-size:6pt}
.st-ledger tbody td{border-bottom:.5pt solid var(--st-rule)}
.st-ledger .r{text-align:right;white-space:nowrap}
.st-ref{font-size:7.2pt;color:var(--st-ink-2);letter-spacing:.015em;padding-top:1.35mm !important}
.st-title{font-weight:600;color:var(--st-navy)}
.st-aud{display:block;font-size:7pt;color:var(--st-ink-3);margin-top:.25mm;line-height:1.28}
.st-acct{font-size:7.2pt;color:var(--st-ink-2)}
.st-st{position:relative;padding-left:3.1mm}
.st-dot{position:absolute;left:0;top:.28em;width:5.6pt;height:5.6pt;overflow:visible}
.st-when{display:block;font-size:7pt;color:var(--st-ink-3);margin-top:.2mm;white-space:nowrap}
.st-final{font-weight:600}
.st-dash{color:var(--st-ink-4)}
.st-na{font-style:italic;font-size:6.9pt;color:var(--st-ink-3);line-height:1.2;white-space:normal}
.st-committed{font-style:italic;font-size:6.9pt;color:var(--st-ink-3);white-space:normal}
/* Italic ending flush with the table's right edge, with no note mark after
   it: the slant of the last letter ("priced", "committed") runs past the edge
   and the PDF clips it. A hair of room keeps the letter whole. */
.st-edge{padding-right:.22em}
.st-est{font-weight:600}
.st-est-tag{display:block;font-size:6.2pt;font-weight:400;font-style:italic;color:var(--st-ink-3)}
.st-grp td{padding:3.6mm 0 1.1mm !important}
.st-grp b{font-size:6.6pt;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--st-navy)}
.st-grp span{font-size:7pt;color:var(--st-ink-3);margin-left:2.2mm}
.st-sub td{font-weight:600;border-top:.75pt solid var(--st-navy);border-bottom:0 !important;padding-top:1.2mm;padding-bottom:1.4mm}
.st-subnote{display:block;font-size:6.5pt;font-weight:400;color:var(--st-ink-3);margin-top:.3mm}
.st-sub .st-q,.st-total .st-q{font-size:6.4pt;vertical-align:baseline;margin-right:.9mm;font-weight:400;font-style:italic}
.st-total td{font-weight:700;font-size:8.2pt;border-top:2.4pt double var(--st-navy);border-bottom:0 !important;padding-top:1.5mm}
.st-empty{padding:4mm 0;font-size:7.6pt;color:var(--st-ink-3)}

/* Notes: numbered, two columns, set like a fund report's footnotes. They read
   ACROSS then down (1 | 2, then 3 | 4), because a page break falls between
   grid rows: read down the columns, a break put 1 and 3 on one page and 2 and
   4 on the next. The last row sits in .st-notes-end with the sign-off. */
.st-notes{margin-top:5mm}
.st-notes ol{margin:0;padding:0;list-style:none;display:grid;grid-template-columns:1fr 1fr;grid-auto-flow:row;column-gap:8mm;align-items:start}
.st-notes li{break-inside:avoid;font-size:6.9pt;line-height:1.42;color:var(--st-ink-2);margin:0 0 1.9mm;padding-left:3.4mm;position:relative}
.st-notes li > i{position:absolute;left:0;top:0;font-style:normal;font-weight:700;color:var(--st-teal)}
.st-notes li b{color:var(--st-navy);font-weight:600}
.st-sign{margin-top:2.2mm;padding-top:1.8mm;border-top:.5pt solid var(--st-rule);display:flex;flex-wrap:wrap;justify-content:space-between;gap:1mm 6mm;
  font-size:6.6pt;color:var(--st-ink-3);break-inside:avoid;break-before:avoid}
/* Notes turned off: the sign-off prints on its own, straight under the table. */
.st-sign-only{margin-top:0}
.st-nw{white-space:nowrap}

/* Phone: stack the grids; the ledger scrolls inside its own box, never the page. */
@media screen and (max-width:640px){
  .st-sheet{padding:22px 16px 28px}
  .st-mast-body,.st-summary{grid-template-columns:1fr;row-gap:6mm}
  .st-summary-one .st-figs,.st-summary-one .st-meter{max-width:none}
  .st-mast-top{flex-wrap:wrap}
  .st-cluster-head{flex-wrap:wrap}
  .st-strip{grid-template-columns:1fr}
  .st-strip > div{padding-left:0}
  .st-strip > div + div{border-left:0;border-top:.5pt solid var(--st-rule)}
  .st-sec{flex-wrap:wrap}
  .st-sec-aside{white-space:normal;text-align:right}
  .st-notes ol{grid-template-columns:1fr}
}

/* ── Print ───────────────────────────────────────────────────────────────── */
/* ONE unnamed @page. size names an ORIENTATION only, so Chrome keeps its paper
   menu: US readers pick Letter, everyone else A4. Named pages were tried and
   dropped: a visible element before a named page forces a break and leaks
   Chrome's own header onto it.
   All six top and bottom margin areas are claimed, so Chrome's own date, title
   and URL cannot print whether "Headers and footers" is on or off. Safari and
   Firefox do not print margin areas, which is why the hint says Chrome or Edge. */
@page{
  size:portrait;
  margin:16mm 16mm 19mm;
  @top-left{content:""}
  @top-center{content:""}
  @top-right{content:""}
  @bottom-left{content:${cssString(footerLeft)};${foot}}
  @bottom-center{content:""}
  @bottom-right{content:${cssString(footerRight)} counter(page) " of " counter(pages);${foot};text-align:right}
}

@media print{
  /* The app shell is not the document. [data-print="hide"] marks the parts that
     are chrome; [role="status"] is the impersonation bar and the toasts. */
  nav,[role="status"],[data-print="hide"],.no-print{display:none !important}
  /* The shell paints bg-background, which under print-color-adjust:exact
     would print as a tinted page. Paper is white. */
  html,body,body > div{background:#fff !important}
  main{max-width:none !important;padding:0 !important;margin:0 !important}
  .st-sheet{width:auto;max-width:none;margin:0;padding:0;box-shadow:none}
  .st-scroll{overflow:visible}
  .st-ledger{min-width:0}
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .st-ledger thead{display:table-header-group}   /* column heads repeat on every page */
  .st-ledger tr{break-inside:avoid}
  .st-grp{break-after:avoid}                      /* a group heading never strands */
  .st-sub,.st-total{break-before:avoid}          /* the total sits in the last tbody, so this binds */
  .st-mast,.st-summary,.st-strip,.st-notes li{break-inside:avoid}
  /* Notes may split BETWEEN rows (never inside a note), so a long ledger does
     not push the whole block onto an almost empty last page. The heading stays
     with the first row (.st-sec break-after). The sign-off stays with the last
     row by sharing an unbreakable block with it: break-before:avoid on the
     sign-off alone did not hold after a grid, and it printed alone on a blank
     last page. */
  .st-notes-end{break-inside:avoid}
}
`
}
