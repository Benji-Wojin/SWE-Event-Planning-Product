import type { Metadata } from 'next';
import { ThemeToggle } from '@/components/theme-toggle';
import { PrivacyLinks } from '@/components/privacy-links';

export const metadata: Metadata = {
  title: 'Privacy policy — Weft',
  description: 'How Weft handles account, project, Gmail, and AI-processing data, and how to request deletion.',
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-8 sm:px-10">
      <header className="mb-12 flex items-center justify-between gap-4">
        <a href="/" className="text-2xl font-semibold" aria-label="Weft home">weft</a>
        <ThemeToggle />
      </header>
      <article className="space-y-8 text-sm leading-7 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_a]:underline [&_a]:underline-offset-4 [&_p+p]:mt-3 [&_li]:mt-2">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Privacy policy</h1>
          <p className="mt-3 text-muted-foreground">Effective October 13, 2026</p>
          <p>Weft is an event-planning service operated by Benji Wojin. This policy covers Weft at weftplan.com. For privacy questions, support, or data requests, email <a className="break-all" href="mailto:gathertemporary@gmail.com">gathertemporary@gmail.com</a>.</p>
        </div>
        <section aria-labelledby="data-collected">
          <h2 id="data-collected">Information Weft handles</h2>
          <ul className="list-disc pl-5">
            <li><strong>Account information:</strong> your Google account identifier, verified email address, and name, used to sign you in and associate you with your projects and invitations. Signing in does not give Weft access to Gmail.</li>
            <li><strong>Project information:</strong> event details, tasks, assignments, updates, comments, invitations, guest information, uploaded files, and other information you or your team add. Only add other people’s information when you have permission to do so.</li>
            <li><strong>Optional Gmail information:</strong> the connected address, authorization tokens, message and thread identifiers, labels, sender, subject, message text, dates, and generated suggestions, as described below.</li>
            <li><strong>Service information:</strong> sign-in cookies, browser preferences, support messages, feedback, and technical request/error information used to operate, troubleshoot, and protect the service. Hosting providers may process IP addresses and request metadata.</li>
          </ul>
        </section>
        <section aria-labelledby="gmail">
          <h2 id="gmail">Gmail is optional</h2>
          <p>You can use Weft without connecting Gmail. If you connect it, Weft requests read-only access to find project emails and prepare updates. This connection cannot send, modify, or delete messages in Gmail. Google’s read-only permission covers your mailbox; selecting projects in Weft limits how Weft uses messages, not the scope of Google’s permission.</p>
          <p>Manual import reads messages from a Gmail label you choose. Automatic detection requires a separate opt-in and selected projects. It checks message sender, subject, and text to decide whether a message relates to those projects. This can include unrelated or personal messages before their relevance is known. A new connection starts with the previous seven days; later checks resume from saved progress. Recovery after an expired Gmail history may recheck that period. Gmail attachments are not imported or sent for this detection.</p>
          <p>Likely matches and uncertain matches are stored privately for the connected user to review. Messages classified as unrelated are not stored as imported emails, although processing identifiers and deduplication records may be retained. AI can make mistakes. Draft summaries do not change shared tasks until you approve an update. Imported original messages remain private to your account within Weft; an approved summary or task update becomes visible to the relevant project members.</p>
          <p>Email invitations use a separate, optional send-only Gmail connection configured by an authorized organizer. When used, Weft sends the requested invitation through that sender’s account to the invitee. The read-only connection does not grant sending permission, and in-app invitations do not require a Gmail sending connection.</p>
        </section>
        <section aria-labelledby="ai">
          <h2 id="ai">AI processing and service providers</h2>
          <p>With your automatic-detection consent, Weft sends email sender, subject, and body text, together with selected project/task names, event dates, locations, and matching identifiers, to Groq to classify relevance and draft summaries. Checks can run while you are away. Attachments are excluded. The event planner also sends the event details disclosed in its separate consent to Groq when you request an AI plan.</p>
          <p>Groq processes these inputs and outputs to provide the AI service. Its published <a href="https://console.groq.com/docs/your-data">data-handling documentation</a> describes limited retention for reliability or abuse investigations, generally up to 30 days unless legally required for longer, and retention of usage metadata. Weft does not promise zero retention by Groq.</p>
          <p>Weft uses Vercel for hosting and private file storage, Turso for its database, Google for sign-in and optional Gmail access, and Groq for the AI features above. These providers process the information needed for their services. Processing may occur in the United States or other countries where providers operate. Opening a suggested external website is subject to that website’s own privacy practices.</p>
        </section>
        <section aria-labelledby="google-data">
          <h2 id="google-data">Limits on Google-data use</h2>
          <p>Weft’s use and transfer of information received from Google APIs will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including its Limited Use requirements.</p>
          <p>Weft does not sell Google user data, use it for advertising or credit decisions, or use it to train general-purpose AI models. It uses that information to provide the email and planning features you choose. Human access to Google-derived information is limited to your explicit permission for specific data, necessary security investigation, legal requirements, or aggregated and anonymized internal operations as allowed by Google’s policy. Sharing with service providers is limited to the disclosed service, security, and legal purposes; project sharing happens when you approve it.</p>
        </section>
        <section aria-labelledby="security">
          <h2 id="security">Storage and security</h2>
          <p>Weft uses HTTPS, authenticated project access, and encrypted storage for Gmail authorization tokens and imported message payloads. Shared project information is accessible according to project roles. No system can guarantee absolute security. Please do not upload passwords, payment-card details, or information that is not needed for your event.</p>
        </section>
        <section aria-labelledby="retention">
          <h2 id="retention">Retention, disconnecting, and deletion</h2>
          <p>Account and project records, uploaded files, imported messages, and approved updates remain stored until removed through an available app control or a verified deletion request. They do not automatically expire when an event ends. Hiding, dismissing, or archiving an item is not a promise of permanent deletion.</p>
          <p>In <a href="/settings">Gmail settings</a>, you can pause automatic detection or revoke access and disconnect. Disconnecting removes the stored Gmail connection; it does not delete previously imported messages, generated summaries, or updates already shared with your project. You can also remove Weft’s access in your <a href="https://myaccount.google.com/connections">Google account connections</a>. Revoking access at Google does not itself delete data already stored by Weft.</p>
          <p>To request access, correction, or deletion of your Weft account, imported Gmail data, or other personal information, email <a className="break-all" href="mailto:gathertemporary@gmail.com?subject=Weft%20privacy%20request">gathertemporary@gmail.com</a> from your account’s address and identify what you want removed. Guest-list participants can also contact this address. Do not send passwords or identity documents. Requests are handled manually; Weft may ask for information needed to verify your identity and authority over shared records.</p>
          <p>Deletion is not instantaneous. We will explain the outcome and any information that must be retained for security, legal obligations, or another person’s rights. Provider backups and required operational records may persist under provider retention practices. Deleting Weft data does not delete the original email in Gmail or copies others have already received.</p>
        </section>
        <section aria-labelledby="changes">
          <h2 id="changes">Policy changes and contact</h2>
          <p>Updates will appear on this page with a revised effective date. A materially different use of connected Gmail data will require an updated disclosure and consent before that use begins. Contact Benji Wojin at <a className="break-all" href="mailto:gathertemporary@gmail.com">gathertemporary@gmail.com</a> with questions about this policy or your information.</p>
        </section>
      </article>
      <footer className="mt-12 border-t pt-6"><PrivacyLinks /></footer>
    </main>
  );
}
