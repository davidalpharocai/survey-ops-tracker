/**
 * Who a signed-in salesperson is, and whose book they work.
 *
 * Normally the same person. They differ when an admin points one salesperson at
 * another's book (migration 121, `salespeople.sees_book_of`): John Farrall
 * working Alex Pinsky's accounts until he has his own. RLS already scopes every
 * row to that book; this type exists so the page can SAY so. A screen headed
 * "John Farrall" over a list of Alex's surveys, with nothing to explain it,
 * reads as a leak.
 */
export type SalesIdentity = {
  /** The signed-in person's own canonical name. Null when the account is not an
   *  active salesperson. */
  name: string | null
  /** Whose book they are looking at, when it is not their own. */
  bookOf: string | null
}

/** The line beside a page title: "John Farrall · Alex Pinsky's book", or just
 *  the name when the book is their own. */
export function salesHeaderLabel(id: SalesIdentity): string | null {
  if (!id.name) return null
  return id.bookOf ? `${id.name} · ${id.bookOf}'s book` : id.name
}

/** Whose accounts the rows on screen belong to — for sentences like "No surveys
 *  are currently on Alex Pinsky's accounts", which must name the book's owner,
 *  not the reader. */
export function bookOwner(id: SalesIdentity): string | null {
  return id.bookOf ?? id.name
}
