# Auth email templates (Supabase)

Branded AlphaROC templates for the Survey Ops Command Center's Supabase auth emails.
Each `.html` file is the **message body**; paste it into the matching template in the
Supabase dashboard.

## Where they go
Supabase Dashboard → **Authentication → Emails** → pick the template tab → **Body → Source**
tab → paste the file's contents. Set the **Subject** from the table below.

> Template editing is **locked until custom SMTP is configured** (Authentication → Emails →
> Set up SMTP). We send via **Resend** from `noreply@alpharoc.ai` (host `smtp.resend.com`,
> port 465, user `resend`, password = Resend API key), which also fixes deliverability. The
> `alpharoc.ai` domain must be **verified in Resend** first — SPF (TXT) + bounce MX on the
> `send` subdomain and a DKIM TXT at `resend._domainkey`, all added in **Wix DNS** (enter the
> host as just the prefix; Wix auto-appends the domain). Leave the existing Google Workspace
> root SPF/MX and the single `_dmarc` record untouched.

## Files & subjects
| Supabase template | File | Subject |
|---|---|---|
| Invite user | `invite-user.html` | You're invited to the AlphaROC Survey Ops Command Center |
| Confirm signup | `confirm-signup.html` | Confirm your AlphaROC Survey Ops email |
| Reset password | `reset-password.html` | Reset your AlphaROC Survey Ops password |
| Magic Link | `magic-link.html` | Your AlphaROC Survey Ops sign-in link |

## `{{ .ConfirmationURL }}`
This is a **Supabase template variable**, not a value to fill in. Leave the literal text
`{{ .ConfirmationURL }}` in place — Supabase replaces it with the recipient's unique action
link at send time. It appears **twice** in each file (the button `href` and the fallback URL
line); leave both.

## Expiry wording
The "expires in N hours" line should match **Authentication → Settings → Email OTP
Expiration** (default ~1 hour). Invite/confirm say 24h, reset/magic say 1h — adjust the text
if your setting differs.
