/**
 * The words for every column in the panel view: one copy, so the desktop
 * table's (i), the phone list's "What these figures mean" and the chart's
 * table twin all explain a figure the same way.
 *
 * ── ONE NAME FOR ONE NUMBER ─────────────────────────────────────────────────
 * What a panel charges for one complete is called "price per complete" here and
 * nowhere "CPI". The finance spec and PureSpectrum both say CPI, but it is not
 * one of the ten terms in the glossary drawer, and the panel table and the wave
 * table sit on the same card — so two names for the same number would have a
 * reader wondering which column they were comparing.
 */

export interface ColumnWords { label: string; help: string }

export const SUPPLIER_COLUMNS = {
  panel: {
    label: 'Panel',
    help: 'The PureSpectrum supplier the completes were bought from. Pick one to see its waves.',
  },
  spend: {
    label: 'Spend',
    help: 'What we paid this panel: its price per complete × the completes we bought from it, added over every wave in view. A purchase with no price recorded adds nothing, so a panel with one is a floor.',
  },
  share: {
    label: 'Share',
    help: 'This panel’s part of all panel spend in view.',
  },
  completes: {
    label: 'Completes bought',
    help: 'Respondents we paid this panel for, before QA.',
  },
  cpc: {
    label: 'Price per complete',
    help: 'Spend ÷ completes bought, counting only purchases that carry a price. A purchase recorded at $0 is a price and is counted, which pulls the average down — it is the one thing here that is not compared inside a wave.',
  },
  vsAll: {
    label: 'vs all panels',
    help: 'This panel’s price per complete against all panels together in this view. +23% means it charged 23% more per complete; −10% means 10% less.',
  },
  surveys: {
    label: 'Studies',
    help: 'Studies in view this panel delivered completes on.',
  },
  waves: {
    label: 'Waves',
    help: 'PureSpectrum launches (waves) this panel delivered completes on. A study with no launch recorded counts as one wave.',
  },
  above: {
    label: 'Paid above the cheapest panel in the same wave',
    help: 'In each wave that bought from two or more panels, what this panel was paid above the cheapest one: (its price − the cheapest price) × its completes. Direction only: panel capacity and per-panel QA are not recorded, so the cheaper panel may not have had the volume.',
  },
} satisfies Record<string, ColumnWords>

export const WAVE_COLUMNS = {
  survey: {
    label: 'Study',
    help: 'The study this wave belongs to. Opens the project page, where its Suppliers panel shows the same wave.',
  },
  label: {
    label: 'PS Survey#',
    help: 'The PureSpectrum survey number, as recorded on the launch.',
  },
  date: {
    label: 'Launch date',
    help: 'When this wave was launched, as recorded on the launch.',
  },
  country: {
    label: 'Country (as recorded)',
    help: 'The country the launch note records, written the way it was entered (“United States” or “en_US”). Country is not yet a field of its own, so “not recorded” means the note does not say.',
  },
  cpi: {
    label: 'This panel’s price per complete',
    help: 'What this panel charged per complete in this wave. PureSpectrum calls it CPI.',
  },
  cheapest: {
    label: 'Cheapest price per complete in the wave',
    help: 'The lowest price any panel charged in this wave, among panels that bought completes at a price. When this panel was the only one, it is its own price.',
  },
  completes: {
    label: 'Completes',
    help: 'Completes bought from this panel in this wave, before QA.',
  },
  cost: {
    label: 'Cost',
    help: 'This panel’s price per complete × its completes in this wave.',
  },
  above: {
    label: 'Cost above the cheapest',
    help: '(This panel’s price per complete − the cheapest in the wave) × its completes. “Only panel” means no other panel bought completes at a price in that wave; “no price” means this purchase has no price recorded, so it cannot be compared (nor can one “priced at $0”).',
  },
} satisfies Record<string, ColumnWords>
