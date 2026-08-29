/**
 * Tawk.to live chat widget.
 *
 * Disabled: its floating tropical-island launcher is not part of the product
 * UI. The admin configuration remains intact, so this can be restored later
 * by re-enabling the script below.
 */
export function Tawk({
  propertyId: _propertyId,
  widgetId: _widgetId,
}: {
  propertyId: string;
  widgetId: string;
}) {
  return null;
  /* eslint-disable-next-line @typescript-eslint/no-unreachable-code */
  return (
    <script
      id="tawk-widget"
      async
      dangerouslySetInnerHTML={{
        __html: `var Tawk_API=Tawk_API||{},Tawk_LoadStart=new Date();(function(){var s1=document.createElement("script"),s0=document.getElementsByTagName("script")[0];s1.async=true;s1.src="https://embed.tawk.to/${_propertyId}/${_widgetId}";s1.charset="UTF-8";s1.setAttribute("crossorigin","*");s0.parentNode.insertBefore(s1,s0);})();`,
      }}
    />
  );
}
