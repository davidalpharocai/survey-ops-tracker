# Deploying Survey Ops Tracker to Vercel

This guide walks you through getting the app live on the internet using GitHub and Vercel. No prior experience required.

---

## Before You Start

Make sure you have accounts at:
- [github.com](https://github.com) (free)
- [vercel.com](https://vercel.com) (free — sign in with your GitHub account)

---

## Step 1: Create a GitHub Repository

1. Go to [github.com/new](https://github.com/new)
2. Name the repository `survey-ops-tracker`
3. Leave it **Private** (recommended)
4. Do NOT check "Add a README file"
5. Click **Create repository**

GitHub will show you a page with setup instructions. Keep this tab open.

---

## Step 2: Push Your Code to GitHub

Open a terminal (Command Prompt or PowerShell on Windows) and run these commands one at a time.

First, navigate to the project folder:
```
cd "C:\Users\david\Claude Code Projects"
```

Then push to GitHub (replace `YOUR_GITHUB_USERNAME` with your actual GitHub username):
```
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/survey-ops-tracker.git
git branch -M main
git push -u origin main
```

You may be asked to log in to GitHub. Use your GitHub username and password (or a personal access token if you have 2FA enabled).

After this, refresh the GitHub page — you should see your code there.

---

## Step 3: Connect to Vercel

1. Go to [vercel.com](https://vercel.com) and sign in (use "Continue with GitHub")
2. Click **Add New... > Project**
3. Find `survey-ops-tracker` in the list and click **Import**
4. Vercel will auto-detect it as a Next.js project — leave all settings as-is
5. **Do NOT click Deploy yet** — you need to add environment variables first (next step)

---

## Step 4: Add Environment Variables in Vercel

Before deploying, scroll down to the **Environment Variables** section on the Vercel import page.

Add the following variables. To find the values, open your `.env.local` file located at:
```
C:\Users\david\Claude Code Projects\survey-ops-tracker\.env.local
```

Add each variable name and its matching value:

| Variable Name | Where to get the value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Use this exact value: `https://xcfoyxyxovibltwfydbf.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Copy from your `.env.local` file |
| `SUPABASE_SERVICE_ROLE_KEY` | Copy from your `.env.local` file |
| `WEBHOOK_SECRET` | Copy from your `.env.local` file |
| `ANTHROPIC_API_KEY` | Leave blank for now — you will add this in Task 12 |

To add each variable in Vercel:
1. Type the variable name in the **Name** field
2. Paste the value in the **Value** field
3. Click **Add** (or press Enter)

Repeat for each variable.

---

## Step 5: Deploy

Once all environment variables are added, click **Deploy**.

Vercel will build and deploy the app. This takes about 1-2 minutes.

When it finishes, you will see a green checkmark and a URL like:
```
https://survey-ops-tracker-abc123.vercel.app
```

Click that URL — your app is live!

---

## Step 6: Verify the Deployment

Open your live URL and check:

- [ ] The login page loads
- [ ] You can log in with your Supabase credentials
- [ ] The project list page loads
- [ ] You can open a project and see its details

If anything looks broken, check the **Deployments** tab in Vercel and click **View Logs** to see error messages.

---

## Adding Environment Variables Later

If you need to add or update a variable (e.g., `ANTHROPIC_API_KEY` in Task 12):

1. Go to your project in [vercel.com/dashboard](https://vercel.com/dashboard)
2. Click **Settings > Environment Variables**
3. Add or edit the variable
4. Go to **Deployments** and click **Redeploy** on the latest deployment

---

## Redeploying After Code Changes

Every time you push new code to GitHub, Vercel will automatically redeploy:

```
cd "C:\Users\david\Claude Code Projects"
git add survey-ops-tracker/
git commit -m "your description of changes"
git push
```

That's it — Vercel watches your GitHub repo and deploys automatically.
