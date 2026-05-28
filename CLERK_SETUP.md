# Clerk Setup for AIMTutor

This guide is for developers configuring Clerk for AIMTutor. Do not commit live Clerk secrets to git.

## 1. Create Clerk Application

1. Go to [Clerk Dashboard](https://dashboard.clerk.com).
2. Create an application.
3. Name it `AIMTutor`, or use your deployment-specific name.
4. Enable:
   - Email
   - Google OAuth, optional
   - GitHub OAuth, optional
5. Disable phone number unless your deployment explicitly needs it.

## 2. Get API Keys

Go to Developers -> API Keys and copy both keys:

```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...
```

Add `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` to the frontend environment and `CLERK_SECRET_KEY` to the backend/server environment. For local AIMTutor development, both can live in your ignored local `.env`.

## 3. Configure Sign-Up Fields

Go to User & Authentication -> Email, Phone, Username.

Required fields:

- Email
- First name
- Last name

Recommended optional field:

- Profile image

## 4. Set Up Admin Role

Clerk uses `publicMetadata` to store the AIMTutor role.

To make a user admin:

1. Go to Users.
2. Click the user.
3. Open Metadata.
4. Set `publicMetadata`:

```json
{
  "role": "admin"
}
```

The first user can be promoted manually in the Clerk dashboard. If webhook auto-promotion is enabled later, the first `user.created` event can promote the first active user automatically.

## 5. Configure Webhooks

1. Go to Webhooks.
2. Add an endpoint.
3. Use this URL:

```text
https://your-domain.com/api/webhooks/clerk
```

For local development, expose the backend with ngrok:

```powershell
ngrok http 8001
```

Then use the ngrok HTTPS URL plus `/api/webhooks/clerk`.

Subscribe to:

- `user.created`
- `user.updated`
- `user.deleted`
- `session.created`

Copy the signing secret:

```env
CLERK_WEBHOOK_SECRET=whsec_...
```

## 6. Configure JWT Template

This is optional but recommended.

1. Go to JWT Templates.
2. Create a new blank template.
3. Name it `aimtutor-backend`.
4. Add claims:

```json
{
  "userId": "{{user.id}}",
  "email": "{{user.primary_email_address}}",
  "role": "{{user.public_metadata.role}}",
  "firstName": "{{user.first_name}}",
  "lastName": "{{user.last_name}}"
}
```

5. Set lifetime to `60 seconds`.

This enriches backend tokens so FastAPI can read the user's role without extra Clerk API calls.

## 7. Environment Variables Summary

Backend:

```env
CLERK_SECRET_KEY=sk_live_...
CLERK_WEBHOOK_SECRET=whsec_...
```

Frontend:

```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/
```

## 8. Production Checklist

- [ ] `CLERK_SECRET_KEY` is set in the production environment and never committed.
- [ ] Webhook endpoint uses HTTPS.
- [ ] `CLERK_WEBHOOK_SECRET` is set.
- [ ] First admin is promoted via Clerk dashboard before launch.
- [ ] Allowed origins/domains are configured in Clerk Dashboard -> Domains.
- [ ] Rotated any Clerk keys pasted into chat, tickets, screenshots, or logs.
