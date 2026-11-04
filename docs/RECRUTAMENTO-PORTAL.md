# Publicação de vagas e portal de candidatura

## Referência e adaptação

Foi revista a implementação do Enterprise em `pascoalfredy-create/enterprise-performance-platform`, nomeadamente `worker/careers.ts`, `worker/recruitment.ts` e `app/carreiras/page.tsx`. Reaproveita-se a lógica de ligação directa à vaga, candidatura sem conta, consentimento, currículo, dados profissionais e entrada na etapa inicial do processo. O Enterprise permanece inalterado.

O Kianda mantém o seu desenho, as tabelas de vagas/candidatos e o percurso de triagem, entrevista, prova técnica, proposta e admissão. Ao admitir, a candidatura fica ligada à ficha e o acolhimento usa as listas já configuradas pela empresa. A admissão é explícita e só ocorre a partir da proposta.

## Percurso do RH

1. Em **Recrutamento → Nova vaga**, preencher os dados e escolher **Criar e publicar**; também se pode guardar a vaga e publicá-la depois.
2. A ficha apresenta uma ligação estável em `/carreiras/:empresa/vagas/:vaga`, **Copiar ligação** e **Abrir portal de candidatura**.
3. A ligação pode ser partilhada nos canais escolhidos pela empresa. A publicação no Kianda não publica automaticamente em redes sociais.
4. As candidaturas entram automaticamente em **Recebida**, com origem **Página de carreiras**, consentimento e histórico. CVs e dados profissionais ficam na ficha do candidato.
5. **Suspender candidaturas** ou **Fechar vaga** desactiva a ligação para novas submissões. Retomar/reabrir utiliza a mesma ligação. O termo do prazo também bloqueia a lista, o detalhe e a submissão, incluindo formulários já abertos.

O intervalo salarial interno não é divulgado no portal. Só o proprietário e o RH publicam vagas; a chefia responsável trata os candidatos das suas vagas.

## Percurso do candidato

O candidato abre a ligação sem iniciar sessão, consulta a descrição e os requisitos e preenche nome, email e telefone. Pode anexar o CV (PDF, Word DOCX ou imagem, até 5 MB) ou indicar uma ligação HTTP/HTTPS. Um ficheiro escolhido por engano pode ser removido antes de enviar. Apresentação e dados profissionais são opcionais.

Após o consentimento e o envio, recebe confirmação no ecrã e uma referência. Não é criada uma conta Kianda. O fluxo não depende de envio de emails.

Uma falha de rede devolve o controlo ao candidato e conserva os campos e o ficheiro seleccionado. O email da candidatura é normalizado. Uma segunda submissão para a mesma vaga não substitui os dados nem os documentos já recebidos.

## Integridade e acesso

- Candidatura, consentimento, histórico, auditoria e metadados do CV usam a mesma transacção PostgreSQL. Falhas desfazem a candidatura; cópias R2 de operações falhadas são limpas.
- A recepção é serializada por empresa para impedir duplicados concorrentes e ultrapassagem das quotas. A validação do ficheiro ocorre antes dos bloqueios de gravação.
- A assinatura do ficheiro determina o formato; o nome ou MIME enviado não bastam. O corpo do pedido e os campos têm limites.
- Tal como no Enterprise, a superfície pública tem limites de recepção: 200 candidaturas por empresa em 24 horas e 30 por origem em uma hora. A origem é guardada como resumo criptográfico por empresa; não é guardado o IP em claro. O limite também se aplica quando há pedidos simultâneos.
- Os CVs são privados: apenas RH/proprietário e a chefia da vaga acedem. Conhecer a ligação ou o identificador não permite ver ou alterar documentos. Anexos posteriores exigem sessão e permissão.
- A eliminação de um candidato não contratado remove também os ficheiros. Candidatos já admitidos mantêm a protecção do percurso de contratação.
- Um módulo RH sem licença de escrita não recebe novas candidaturas públicas. No período experimental activo, o recrutamento funciona de acordo com o acesso RH existente.
- Transições incluem verificação da etapa anterior; pedidos desactualizados devolvem conflito. Vagas fechadas não avançam candidaturas nem admitem pessoas. A admissão verifica novamente a proposta sob bloqueio para impedir contratações duplicadas.

## Verificação

Os testes usam empresas e candidatos sintéticos. Cobrem publicação parcial sem perder os pressupostos da vaga, ligação directa, campos internos omitidos, prazo e estados, consentimento, PDFs/DOCX, acesso aos CVs, rejeição de ficheiros inválidos, rollback, pedidos concorrentes, quotas, licença, transições e admissão. Os testes de navegador cobrem criação/publicação, candidatura anónima, remoção do CV antes do envio, entrada no processo, indisponibilidade, recuperação de rede e utilização num telefone.

A migração `0050_recruitment_public_portal.sql` acrescenta apenas o perfil profissional opcional ao candidato e um índice para a recepção pública. Não altera candidatos, vagas ou contratos existentes.
