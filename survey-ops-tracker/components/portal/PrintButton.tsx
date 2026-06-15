'use client'

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="print:hidden text-sm border border-slate-300 text-slate-700 hover:bg-slate-100 px-4 py-1.5 rounded-lg transition-colors"
    >
      Print / Save as PDF
    </button>
  )
}
