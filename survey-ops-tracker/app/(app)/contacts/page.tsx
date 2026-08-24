import { redirect } from 'next/navigation'

// There is no global contact roster: contacts belong to a client, and the client
// page's Contacts card is where they are added and edited. Only /contacts/[id]
// is a real page, so send a bare /contacts (or a trimmed-back URL) to Admin, the
// same place the contact page's "not found" state falls back to — the client list
// there is one click from any contact.
export default function ContactsPage() {
  redirect('/admin')
}
