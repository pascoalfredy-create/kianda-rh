# Recrutamento: notificações, negociação e ATS

## Utilização

- Cada candidatura recebida, mudança de etapa e admissão gera um email automático. Comentários e motivos internos de recusa ficam no RH. A ficha permite consultar os estados das mensagens.
- Em **Editar vaga → ATS**, definir até 12 requisitos profissionais e pesos que somem 100%. A ficha do candidato mostra a evidência, informação em falta e experiência declarada abaixo do mínimo. Não há exclusão, ordenação ou contratação automáticas.
- Em **Rever perfil profissional e analisar CV**, preencher competências ou ler um PDF com texto / Word DOCX. A extracção é local no navegador. Rever o texto antes de guardar; pode removê-lo. Um PDF digitalizado precisa de OCR. Os originais continuam nas opções de anexos existentes.
- Na etapa **Proposta**, preparar uma contraproposta ou aceitar a pretensão. A aceitação exige confirmar que o valor é a **base bruta mensal**, evitando confundir líquido com bruto. Para pretensões líquidas, apurar primeiro a base no simulador salarial.
- **Gerar proposta para revisão** cria um rascunho versionado; **Ver proposta** abre a carta. A impressão/PDF respeita a licença paga e continua bloqueada durante o teste.
- O envio por email é separado da geração. Indicar o email do RH para resposta. O candidato responde à equipa; o RH regista aceitação, recusa ou nova pretensão, identificando a origem da resposta. O sistema não apresenta esse registo como uma assinatura digital.
- Uma nova versão substitui a anterior. Quando existir proposta, a admissão exige aceitação e transporta a base e os subsídios acordados. O servidor impede uma remuneração divergente. A pretensão original permanece no histórico.

## Entrega de emails

Usa a configuração Resend existente (`KIANDA_RESEND_API_KEY` e `KIANDA_MAIL_FROM` no GitHub). As mensagens são gravadas na mesma transacção da mudança; o envio corre depois do commit, com uma ligação própria, e tem reserva na tarefa agendada existente.

A caixa de saída reclama pequenos lotes com `FOR UPDATE SKIP LOCKED`, sem chamadas HTTP durante os bloqueios. Cada mensagem usa a mesma chave de idempotência no Resend. Falhas temporárias têm até seis tentativas; entregas incertas com mais de 23 horas exigem verificação no fornecedor, antes de um reenvio, porque a deduplicação do Resend expira às 24 horas. «Enviado» significa aceite pelo fornecedor, não uma confirmação de leitura ou de entrega na caixa do destinatário.

Sem configuração, as mensagens aguardam. Sem email do candidato, o estado é explícito. O botão de nova tentativa não duplica mensagens já enviadas. A eliminação de uma candidatura também elimina as suas propostas, caixa de saída e texto do CV. Novas tabelas têm RLS por empresa e validação de pertença do candidato.

## Validação

Testes sintéticos de transições concorrentes, recepção pública, duplicados, preservação dos motivos internos, propostas e negociação, admissão, isolamento de empresas e eliminação. Fornecedor de email simulado para repetição idempotente, dispatchers concorrentes e entrega incerta. Testes de navegador cobrem a leitura/remoção do CV, ATS, carta, bloqueio de PDF no teste, remuneração na admissão e telefone. Nenhuma candidatura real é movimentada nos testes.
