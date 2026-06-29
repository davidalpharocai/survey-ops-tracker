import { ReviewQueue } from '@/components/deliverables/ReviewQueue'

export const dynamic = 'force-dynamic'

export default function DeliverablesPage() {
  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-lg font-semibold">Deliverables — Review queue</h1>
      <p className="text-sm text-muted-foreground mt-1 mb-4">
        Emailed deliverables we couldn&apos;t auto-file to a single client + project land here — confirm the client/project to file them.
        Most deliverables auto-file straight to the client&apos;s Shared Drive folder; you can also attach one directly from any project page.
      </p>
      <ReviewQueue />
    </div>
  )
}
