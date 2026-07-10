# Cronos Odonto Software

Software de gestão comercial e operacional para clínicas odontológicas.

Criado para organizar a rotina da clínica com mais clareza, controle e inteligência.

© 2026 Cronos Odonto Software. Todos os direitos reservados.


## Ajustes SEO aplicados

- A página inicial (`/`) agora é uma landing page pública e indexável para a marca Cronos Odonto.
- A aplicação original foi movida para `/app/`.
- A rota `/login/` redireciona para `/app/` e está marcada como `noindex`.
- As áreas internas `/app/` e `/superadmin/` foram marcadas com `noindex, nofollow`.
- Foram adicionados `robots.txt`, favicon, logo oficial extraída do sistema original, imagem Open Graph com a marca oficial e dados estruturados JSON-LD.
- Após publicar, verificar o domínio no Google Search Console e solicitar indexação da home.


Observação de marca:
- A logo principal e o favicon agora usam os vetores oficiais já existentes no sistema original.
- O Open Graph foi refeito usando a logo oficial do Cronos Odonto.

- Os links internos da landing usam caminhos relativos para funcionar tanto no domínio publicado quanto em prévia local.

## Atualização de identidade visual

- A landing agora usa a marca oficial do Cronos Odonto nas cores originais.
- `assets/brand/cronos-symbol-2d.png`: símbolo oficial em 2D com fundo transparente.
- `assets/brand/cronos-symbol-3d.png`: opção oficial em 3D com fundo transparente.
- `assets/brand/favicon.png` e `apple-touch-icon.png`: ícones gerados a partir do símbolo 2D.
- `assets/brand/og-cronos-odonto.png`: imagem social/Open Graph refeita com a marca oficial.


## Ajuste de identidade visual
- `logo-cronos-odonto.png` agora usa apenas o símbolo oficial, sem wordmark inventado.
- `logo-cronos-odonto-horizontal.png` fica como versão de apoio com fundo claro para visualização/compartilhamento.
- `og-cronos-odonto.png` foi refeita em versão escura, mais limpa, usando a logo 2D oficial.

## Atualização da landing pública

A página inicial foi redesenhada com foco comercial/institucional, removendo textos visíveis sobre SEO/Google. O SEO técnico continua presente no código por meio de metatags, canonical, Open Graph, JSON-LD, robots.txt e favicon na raiz do site.



## Ajuste de favicon e sitemap
- Sitemap XML removido da versão publicada.
- Favicon adicionado na raiz do site (`/favicon.ico`, `/favicon-48x48.png`, `/favicon-192x192.png`, `/apple-touch-icon.png`) para facilitar o reconhecimento pelo Google.


## v123 — Mundo Odonto V2 repoint seguro

Base: v116 estável.

Correção aplicada:
- Mundo Odonto (`mundoodonto.slzma@gmail.com`) passa a selecionar a fonte V2 correta `2674f63e-36ef-4bf2-a8e8-50f317471708`.
- A fonte `a33fb656-c148-4590-bb35-3c1cbe16d95d` fica isolada como Clínica Teste / Lista dentistas.
- Contatos e leads são lidos das colunas reais de `clinic_contacts` e `clinic_leads`, com fallback para `legacy_payload`.
- Proteções contra salvar arrays vazios por cima da base recuperada da Mundo Odonto.
- Outras clínicas continuam usando o fluxo normal de `clinic_data_sources`/legado; não há redirecionamento global.
