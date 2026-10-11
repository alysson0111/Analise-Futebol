# Resultados em segundo plano

## Ativacao

1. Criar uma conta em https://console.cron-job.org/signup.
2. Criar um cronjob com URL `https://analise-futebol.vercel.app/api/cron-results`.
3. Selecionar execucao a cada minuto, metodo GET e fuso America/Sao_Paulo.
4. Em configuracoes avancadas, adicionar o cabecalho `Authorization`. O valor completo esta no arquivo local `work/cron-job-config.json`.
5. Ativar o cronjob e testar a chamada. HTTP 202 confirma o recebimento, nao a conclusao da apuracao.

A chave esta configurada como variavel sensivel `CRON_SECRET` no Vercel. O arquivo local nao e enviado ao GitHub ou ao deploy. Nunca colocar a chave na URL ou em codigo do navegador.

## Escopo

- Somente jogos de hoje, considerando America/Sao_Paulo.
- O acompanhamento comeca quando a fonte informa jogo ao vivo com 90 minutos ou mais.
- Apenas sinais ja salvos sao apurados; esta rotina nao gera novas entradas.
- O estado fica no Firestore e continua entre chamadas, mesmo com o site fechado.
- Ao desaparecer do ao vivo, a rotina consulta os resultados da mesma data. Desaparecimento nao confirma termino.
- Placar de entrada permanece congelado ate FT confirmado. Green, Push e Red seguem o sinal original.
- Jogos de datas passadas e jogos ja encerrados antes de serem observados nao entram na rotina.
- Ao mudar o dia, o acompanhamento do dia anterior e encerrado sem alterar suas entradas.
- Somente sinais dos confrontos acompanhados sao lidos; nenhum historico completo e varrido.

## Diagnostico

Com o mesmo cabecalho privado, `GET /api/cron-results?status=1` retorna a ultima execucao e seus erros. `GET /api/cron-results?wait=1` aguarda uma execucao para teste manual.

O agendamento depende de ativar a conta externa. Falhas de fonte ou de cota do Firebase impedem a apuracao e sao registradas no estado de execucao; nao produzem resultados presumidos.
