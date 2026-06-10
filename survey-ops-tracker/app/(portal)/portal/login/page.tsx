import { Suspense } from 'react'
import PortalLoginForm from './portal-login-form'

export default function PortalLoginPage() {
  return (
    <div className="flex justify-center pt-16">
      <Suspense>
        <PortalLoginForm />
      </Suspense>
    </div>
  )
}
