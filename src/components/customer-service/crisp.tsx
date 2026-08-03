/**
 * Crisp live chat widget.
 * @see https://docs.crisp.chat/
 *
 * DISABLED — the default Crisp chat bubble (tropical-island avatar)
 * sat in the bottom-right of every page and we don't ship it.
 * The component renders nothing. To re-enable, restore the <script>
 * block below. The Crisp config (website id, enabled flag) is still
 * read from admin settings so re-enabling is a 1-line change.
 */
export function Crisp({ websiteId: _websiteId }: { websiteId: string }) {
  return null;
  /* eslint-disable-next-line @typescript-eslint/no-unreachable-code */
  return (
    <script
      id="crisp-widget"
      async
      dangerouslySetInnerHTML={{
        __html: `window.$crisp=[];window.CRISP_WEBSITE_ID="${_websiteId}";(function(){var d=document;var s=d.createElement("script");s.src="https://client.crisp.chat/l.js";s.async=1;d.getElementsByTagName("head")[0].appendChild(s);})();`,
      }}
    />
  );
}
