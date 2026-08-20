// Microsoft Clarity is emitted as native, async script tags so it is present
// in SSR HTML and begins recording without waiting for hydration.
export function MicrosoftClarity({ projectId }: { projectId: string }) {
  if (!projectId) return null;

  return (
    <script
      id="microsoft-clarity"
      async
      dangerouslySetInnerHTML={{
        __html: `(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y)})(window,document,"clarity","script",${JSON.stringify(projectId)});`,
      }}
    />
  );
}
