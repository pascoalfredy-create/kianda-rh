# Importar a base de pessoal

Colaboradores → Importar colaboradores. Aceita Excel XLSX (seleccionar a folha), CSV/TXT, tabelas DOCX e PDF com texto seleccionável. Até 10 MB, 5.000 colaboradores por ficheiro e 128 colunas; PDF mantém o limite de páginas já aplicado ao leitor. XLS, XLSM e DOC devem ser guardados como XLSX/CSV ou DOCX. Não existe OCR.

É possível usar o ficheiro da empresa ou descarregar o modelo em branco. Associe Número, Nome, Função, Admissão e Salário base bruto; os restantes campos são opcionais. Colunas de líquido e total ilíquido não são associadas automaticamente ao salário base. Use Texto no Excel para preservar zeros de números, BI, NIF, INSS e IBAN. Não é possível recuperar dígitos já perdidos na origem.

A admissão mantém a data original. A remuneração tem uma data de efeito independente, por coluna ou opção comum. Meses anteriores à referência importada não passam a ter remunerações históricas conhecidas e os novos vínculos não são elegíveis para processamento anterior à migração. A importação não cria folhas históricas fechadas.

Moeda por linha ou comum: AOA/Kz ou USD. Salário base em USD exige câmbio de referência e fica indexado ao dólar; alimentação e transporte são sempre Kz. O processamento confirma o seu próprio câmbio.

A prévia mostra cada linha, erros, avisos, duplicados e departamentos novos. Pode filtrar erros/avisos e navegar em páginas de 50. Pode remover o documento e recomeçar antes de confirmar. BI, IBAN, contrato, mínimo salarial, data de remuneração e períodos fechados são validados também no servidor com as regras do cadastro individual. A falta de NIF, INSS ou IBAN é um aviso para completar a ficha; não é preenchida com valores inventados.

N.º, NIF, BI e INSS detectam duplicados dentro do ficheiro e apenas na empresa autenticada. «Ignorar existentes» nunca actualiza fichas. Identificadores que apontam a fichas diferentes exigem correcção. Departamentos não existentes só são criados quando autorizado; códigos IMP-xxx são provisórios.

Só proprietário/RH pode importar. A licença e a confirmação são revalidadas na transacção, com bloqueio da empresa partilhado pelo cadastro individual e reactivação. As escritas são feitas em blocos de 200, numa operação atómica. O identificador da confirmação e a impressão digital tornam a repetição segura depois de uma falha de rede. Um erro desfaz todo o lote.

Ficam registados autor, origem, identificador da importação e linhas/fichas criadas em auditoria. Não se guarda o ficheiro original. Não se enviam convites, notificações a candidatos nem tarefas retroactivas de admissão. Documentos publicados aplicáveis ficam disponíveis para aceitação no portal.

O modelo em branco pode ser descarregado durante o teste, porque é uma entrada sem dados da empresa. As restrições a documentos de negócio mantêm-se.
