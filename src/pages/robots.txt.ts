import type {APIRoute} from "astro";

function getRobotsTxt(sitemapURL: URL): string {
    return `User-agent: *
Allow: /

Sitemap: ${sitemapURL.href}
`;
}

export const GET: APIRoute = ({site}: { site: URL | undefined }): Response => {
    const sitemapURL = new URL("sitemap-index.xml", site);
    return new Response(getRobotsTxt(sitemapURL));
};