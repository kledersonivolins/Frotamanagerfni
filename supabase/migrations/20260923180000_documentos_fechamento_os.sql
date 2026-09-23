-- Documento escaneado (PDF ou foto) anexado no fechamento da OS: comprovante
-- de como o veículo saiu (correto ou com pendência). Reaproveita o mesmo
-- bucket de storage já usado pelas fotos de checklist (fotos-checklist),
-- só que numa pasta separada (documentos-os/...), então não precisa criar
-- bucket nem política nova — a política de upload que já funciona hoje
-- pras fotos vale igual pra esses arquivos.

alter table public.ordens_servico
  add column if not exists documentos_fechamento jsonb default '[]'::jsonb;

-- Garante que o bucket aceita PDF (não só imagem) e tem um limite de tamanho
-- razoável. Não mexe em nada se já estiver configurado assim.
update storage.buckets
set allowed_mime_types = null,
    file_size_limit = coalesce(file_size_limit, 15728640)
where id = 'fotos-checklist';
