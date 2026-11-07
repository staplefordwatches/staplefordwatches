# Stapleford Watches dispatch emails

This adds `/dispatch/`, a private-operation page for manually entered orders,
and `/api/dispatch`, its authenticated backend. The branded email uses the
approved wording and navy logo. No checkout event sends a dispatch email.

## Before enabling customer sends

1. In the Cloudflare account that hosts the existing Pages project, create a
   D1 database named `stapleford-dispatch` and run
   `migrations/0001_dispatch_emails.sql` against it. The Cloudflare D1 console
   can execute the file's SQL. Add that database to the Pages project's
   production bindings as **DISPATCH_DB**. A binding with the same name is
   needed for any preview environment where the tool will be tested. Keep
   preview and production databases separate.
2. Under the Pages project's variables and secrets, add these values. Store
   the two confidential values as **encrypted secrets**, never in GitHub,
   client JavaScript, a `.env` committed to Git, or chat:

   | Name | Value |
   | --- | --- |
   | `IONOS_SMTP_PASSWORD` | Password of the existing `ben@staplefordwatches.co.uk` mailbox. |
   | `DISPATCH_ACCESS_KEY` | A new random value of 32–256 characters used only to sign in to the dispatch page. Generate it in a password manager and keep it there. |
   | `DISPATCH_ENABLED` | Plain-text `false` initially. |

3. Deploy the feature branch to the existing Pages project. Apply bindings
   and secrets before using the preview deployment, then redeploy if the
   hosting service requires it. Keep the main storefront unchanged until
   testing is complete.
4. Open the deployed `/dispatch/` page and sign in with the dispatch access
   key. Enter sample order details, including your own name. The recipient
   in the form may be a sample address: **Send test to Ben** always overrides
   it to `ben@staplefordwatches.co.uk` and prefixes the subject with `[TEST]`.
5. Preview and use **Send test to Ben**. Check the received email on desktop
   and mobile: navy logo, white tagline, button text and spacing, all contact
   and footer links, and the tracking destination. Review spam placement and
   the message's authentication results. Use a real tracking link for this
   check. No live SMTP or inbox test was performed during development.
6. After the inbox test passes, set `DISPATCH_ENABLED` to plain-text `true`
   in the production Pages environment and redeploy. Preserve `false` in
   preview environments. Merge/deploy the reviewed code to production only
   when those setup steps and email-client checks are complete.

IONOS Mail Basic/Business uses `smtp.ionos.co.uk:465` with TLS and the full
mailbox address as its username. This sender uses that connection from the
Cloudflare Workers TCP sockets API. It does not move the mailbox or change
inbound mail/DNS records. IONOS Hosted Exchange uses different settings and
would require changing this transport.

## Routine use

Open `/dispatch/` and enter the customer's name, email, unique order number,
watch name/model, tracking number without spaces, and the full HTTPS tracking
URL. For sales outside the online checkout, assign a unique order reference
such as `SW-1001` and keep using that reference for that sale.

For overseas orders, paste the correct courier or verified destination
delivery partner link for the actual parcel. The destination postal operator
is not inferred from the country alone. The tracking number should be
included in the copied courier link. The preview shows the link's hostname
so it can be checked before sending.

Click **Preview email**, check all details, tick the confirmation after the
parcel has been handed to the courier, then click **Send dispatch email**.
The approved email deliberately omits the signature requirement sentence.
Recipients reply to the existing IONOS mailbox.

## Submission history and retries

- **Accepted by IONOS:** SMTP confirmed acceptance for delivery. This is not
  a delivery/open receipt. Further attempts using that order number are blocked.
- **Sending:** the database reservation exists. It may be in progress or an
  interrupted request. Check before taking any action; automated resends are blocked.
- **Uncertain:** submission may have happened but confirmation or logging
  failed. Do not resend automatically. Check with IONOS delivery records and
  the recipient before deciding whether another email is needed.
- **Failed:** SMTP did not reach submission, or rejected an earlier step.
  Correct the settings and use a fresh preview to retry the same order.

SMTP does not offer an idempotency key. An atomic D1 reservation blocks
concurrent/repeated customer sends. Errors after submission starts are kept
as uncertain rather than retried. Never delete a sending/uncertain/accepted
record merely to make the Send button work.

Emails sent through SMTP are not automatically copied into the mailbox's
Sent folder. The protected dispatch history records the submission status,
recipient and parcel details. IONOS inbox bounces should also be monitored.
The log contains customer data: restrict database access, retain it only as
long as needed, and include it in the business's normal data management.

## Access and checks

Sessions expire after 12 hours and use an HttpOnly, Secure, SameSite=Strict
cookie. Preview approvals expire after one hour and are tied to the exact
customer/parcel fields. Editing any field requires another preview. The
database and IONOS password are never exposed to the browser. Rotating
`DISPATCH_ACCESS_KEY` invalidates existing sessions and preview tokens.

Run `node --test tests/dispatch-*.test.mjs` for the protocol, authentication,
preview and duplicate-protection tests. No third-party npm dependency is
required by the sender. Production SMTP connectivity, actual mailbox
authentication, inbox delivery and visual email-client QA require the setup
and self-test described above.

Official references:

- https://www.ionos.co.uk/help/email/general-topics/ionos-mail-server-details-for-imap-pop3-and-smtp/
- https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/
- https://developers.cloudflare.com/d1/worker-api/
- https://www.royalmail.com/sending/international/international-tracked-signed/delivery-partners
