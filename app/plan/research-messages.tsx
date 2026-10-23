import type { ResearchSnapshot } from './use-research';
export function ResearchMessages({ data }: { data: ResearchSnapshot | null }) {
  if (!data?.query) return null;
  return (
    <div className="research-turn" aria-label="Latest saved web research">
      <article className="task-chat-message task-chat-user">
        <span>You · web request</span>
        <p>{data.query}</p>
      </article>
      <article className="task-chat-message task-chat-assistant">
        <span>✦ Weft · web research</span>
        {data.answer ? (
          <>
            <p>{data.answer}</p>
            <ol className="research-sources" aria-label="Sources">
              {data.sources.map((source) => (
                <li key={source.url}>
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    referrerPolicy="no-referrer"
                  >
                    {source.title}
                    <small>{source.host} ↗</small>
                  </a>
                </li>
              ))}
            </ol>
            <small>
              Researched{' '}
              {data.generatedAt && new Date(data.generatedAt).toLocaleString()}.
              Check the sources; pages and answers can be incomplete or change.
            </small>
          </>
        ) : (
          <p>
            {data.status === 'loading'
              ? 'Searching… Check status if the reply does not arrive.'
              : data.status === 'interrupted'
                ? 'This search was interrupted. No verified answer was saved.'
                : 'No cited answer was saved for this request.'}
          </p>
        )}
      </article>
    </div>
  );
}
