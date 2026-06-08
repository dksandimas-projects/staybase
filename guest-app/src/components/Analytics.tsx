import { Helmet } from "react-helmet-async";
import config from "@config";

export function Analytics() {
  if (!config.analyticsId) return null;

  return (
    <Helmet>
      <script async src={`https://www.googletagmanager.com/gtag/js?id=${config.analyticsId}`} />
      <script>
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){window.dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${config.analyticsId}');
        `}
      </script>
    </Helmet>
  );
}
