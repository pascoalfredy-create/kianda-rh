# Descoberta pública do Kianda

A página `https://kianda.yelaperformance.com` apresenta Kianda RH e Integra em HTML de servidor. Sem sessão, responde com 200 sem depender da API; com sessão válida, mantém o painel anterior. O título, a descrição, o endereço canónico, Open Graph e WebSite JSON-LD identificam a plataforma e os dois módulos.

`/robots.txt` anuncia `/sitemap.xml`. O sitemap inclui apenas a apresentação. As páginas internas e os formulários de acesso recebem `noindex, nofollow`; `/modelagem` envia também `X-Robots-Tag`. As páginas de carreiras que as empresas publicam continuam indexáveis. A autenticação, as licenças e as permissões continuam a ser verificadas pela API.

Depois de publicar, o CI executa `node scripts/verify-public-site.mjs https://kianda.yelaperformance.com`: verifica apresentação sem cookies, metadados, sitemap, robots, manifest, login não indexável e redireccionamento do Integra sem sessão.

## Google Search Console

A descoberta não equivale a indexação confirmada. Para acompanhar a situação real no Google:

1. Na conta Google que gere o domínio, adicionar a propriedade `https://kianda.yelaperformance.com/` no Search Console e verificar a propriedade. Usar o método disponibilizado para essa conta; uma verificação DNS exige acesso ao domínio e o valor exacto indicado pelo Google.
2. Submeter `https://kianda.yelaperformance.com/sitemap.xml` em Sitemaps.
3. Inspeccionar `https://kianda.yelaperformance.com/`, testar o URL publicado e pedir indexação.
4. Consultar Indexação de páginas e Desempenho para perceber descoberta, exclusões e pesquisas. Não prometer prazo nem posição para a palavra «Kianda».

Não colocar páginas de empresas, projectos, documentos ou recibos no sitemap. Não contornar o login nem tornar dados de clientes públicos para os motores de pesquisa.

Referências oficiais: [requisitos técnicos](https://developers.google.com/search/docs/essentials/technical), [sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview), [indexação](https://developers.google.com/search/help/crawling-index-faq).
