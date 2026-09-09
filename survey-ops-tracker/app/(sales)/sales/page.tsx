import { redirect } from 'next/navigation'

/**
 * /sales is now a signpost, not a page.
 *
 * The pipeline moved to /sales/surveys when the ribbon gained tabs, and this
 * redirect stays because /sales is the path baked into every existing bookmark,
 * the (app) layout's sales redirect, and lib/sales-auth's own login `next`. A
 * 404 for the tier's own root would be a self-inflicted support ticket.
 */
export default function SalesRoot() {
  redirect('/sales/surveys')
}
