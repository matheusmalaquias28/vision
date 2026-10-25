# Publicando o VISION numa VPS

Passo a passo para rodar o VISION num servidor próprio (Ubuntu 24.04) em
`vision.scalecompany.com.br`, com HTTPS, login próprio, banco no Supabase
(compartilhado com outro sistema, isolado no schema `vision`), integração com o
War, Google Drive e backup diário.

Como fica:

```
navegador ──HTTPS──► Caddy (443) ──┬─► /api, /projects, /music, /sfx, /library ─► Node :4000 (systemd)
                                   └─► resto: apps/web/dist (interface já compilada)

Node :4000 ──► Supabase (Postgres, schema "vision", usuário vision_app)
           ──► War (status e notas)   ──► Google Drive (entrega)   ──► OpenAI
War ──► POST https://vision.scalecompany.com.br/api/webhooks/war
```

Os arquivos prontos estão em [`deploy/`](deploy/).

> **Login:** a API e os vídeos só respondem com sessão válida. Os acessos são
> criados pela linha de comando (passo 7). O único caminho aberto é o webhook do
> War, protegido pelo segredo compartilhado com ele.

---

## 1. Contratar o servidor

| | Mínimo | Recomendado |
|---|---|---|
| CPU | 2 vCPU | **4 vCPU** (o render do Remotion usa todos) |
| Memória | 4 GB | **8 GB** (Chrome do render + ffmpeg) |
| Disco SSD | 80 GB | **~100 GB** com a limpeza automática (passo 5); ~160 GB sem ela |
| Sistema | **Ubuntu 24.04 LTS limpo** | sem n8n ou outros apps pré-instalados (usam as portas 80/443 e memória) |
| Região | | **São Paulo**: os brutos sobem bem mais rápido |

- Na criação, cadastre sua **chave SSH** em vez de senha. No Windows:
  `ssh-keygen -t ed25519` e cole o conteúdo de `C:\Users\<você>\.ssh\id_ed25519.pub`.
- Não precisa de GPU: a transcrição roda na API da OpenAI e o render usa CPU.

Anote o **IP público** do servidor.

## 2. Apontar o domínio

No painel do domínio `scalecompany.com.br`, crie:

| Tipo | Nome | Valor |
|---|---|---|
| A | `vision` | IP do servidor |

> Na Cloudflare, deixe a nuvem **cinza** (só DNS). Com o proxy laranja, uploads
> grandes esbarram no limite de 100 MB por requisição do plano gratuito.

Se o domínio estava apontado para a Vercel, troque o registro e remova o domínio
do projeto da Vercel.

Confira (pode levar alguns minutos): `nslookup vision.scalecompany.com.br`

## 3. Preparar o servidor

Entre como root (`ssh root@IP`) e rode:

```bash
apt update && apt upgrade -y
apt install -y git curl ufw restic fonts-noto-color-emoji fonts-noto-core

# Chrome do render (lista da documentação do Remotion para Ubuntu 24.04)
apt install -y libnss3 libdbus-1-3 libatk1.0-0 libasound2t64 libxrandr2 \
  libxkbcommon-dev libxfixes3 libxcomposite1 libxdamage1 libgbm-dev libcups2 \
  libcairo2 libpango-1.0-0 libatk-bridge2.0-0

# Node.js 24 LTS
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt install -y nodejs
node -v

# Firewall: só SSH e web. A porta 4000 do Node fica fechada para fora.
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw --force enable
```

`fonts-noto-color-emoji` é o que faz os **motions de emoji** aparecerem no MP4.
As outras fontes (legenda e motions) vêm do Google Fonts na hora do render: o
servidor precisa de saída para a internet (`fonts.googleapis.com`). O navegador
do render (Chrome Headless Shell) é baixado sozinho na primeira subida do
VISION (aparece `Remotion: navegador do render pronto` no log).

Crie o usuário que roda o VISION:

```bash
adduser --system --group --home /opt/vision --shell /bin/bash vision
# o script de atualização reinicia o serviço sem pedir senha (só este comando)
echo 'vision ALL=(root) NOPASSWD: /usr/bin/systemctl restart vision' > /etc/sudoers.d/vision
chmod 440 /etc/sudoers.d/vision
```

## 4. Baixar o código

```bash
sudo -iu vision
git clone https://github.com/matheusmalaquias28/vision.git /opt/vision
cd /opt/vision
npm ci
npm test
npm run build -w @vision/web
```

Repositório privado: use um *fine-grained token* do GitHub só com leitura deste
repositório como senha, ou uma *deploy key* SSH.

## 5. Banco de dados (Supabase compartilhado)

O VISION usa **só** o schema `vision` e o usuário `vision_app`, que não enxerga
nada do outro sistema. O script não altera nada fora do schema `vision`.

1. No SQL Editor do Supabase, rode [`db/vision.sql`](db/vision.sql) (troque
   `TROQUE_ESTA_SENHA` só na hora de colar, **não salve a senha no arquivo**).
   Rodar de novo é seguro: cria só o que falta (por exemplo, a tabela `users`
   de uma versão nova) e não muda a senha de um `vision_app` que já existe.
   **Não use `supabase db push`** deste repositório.
2. Pegue o endereço do **pooler compartilhado** em *Connect → Transaction pooler
   → Shared pooler*. O endereço `db.<ref>.supabase.co` só funciona por IPv6.
   Fica assim (ref do projeto depois do ponto no usuário):

   ```
   postgresql://vision_app.<ref>:<senha>@aws-1-<regiao>.pooler.supabase.com:6543/postgres
   ```

   Senha com `@ : / # ? %` precisa ir codificada:
   `node -e "console.log(encodeURIComponent('a-senha'))"`.

## 6. Configuração (`.env`)

Ainda como `vision`:

```bash
cp .env.example .env
nano .env
chmod 600 .env
```

| Variável | Valor |
|---|---|
| `OPENAI_API_KEY` | chave **só deste servidor**, com limite de gasto mensal na OpenAI |
| `MAGNIFIC_API_KEY` | opcional: gera as ilustrações (cada imagem nova gasta crédito; teto de 12 por projeto) |
| `VISION_DATABASE_URL` | URL do passo 5 |
| `VISION_SESSION_SECRET` | assina as sessões de login; gere com `openssl rand -hex 32` |
| `DEMANDAS_WEBHOOK_SECRET` | o **mesmo** segredo configurado no War |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth Client do Google Cloud (API do Drive ativada) |
| `VISION_PUBLIC_URL` | `https://vision.scalecompany.com.br` |
| `VISION_RETENTION` | `on` (liga a limpeza automática; deixe desligado no computador) |
| `VISION_RAW_RETENTION_DAYS` | opcional, padrão `10`: dias depois da entrega no Drive até apagar o bruto |
| `VISION_IDLE_RETENTION_DAYS` | opcional, padrão `30`: projeto sem entrega, dias sem edição até apagar o bruto |
| `VISION_STATUS_ON_DELIVERY` | opcional, padrão `Aprovação do Gestor`: status quando o último vídeo da demanda vai ao Drive (vazio desliga) |

No **Google Cloud**, no OAuth Client, autorize o redirecionamento
`https://vision.scalecompany.com.br/api/google/callback`.

Confira o banco (só lê, não grava nada):

```bash
npm run cli -- db-check     # todas as linhas "ok"
```

## 7. Criar os acessos

Só o **primeiro** acesso, o super admin, é criado pela linha de comando:

```bash
npm run cli -- user add --email contato@energymidia.com.br --name "Seu Nome" --superadmin
```

Sem `--password`, uma senha forte é gerada e mostrada **uma vez**. Depois disso,
os outros acessos são criados na tela **Usuários** do próprio Vision:

| Papel | O que pode |
|---|---|
| Super admin | tudo, inclusive criar e gerenciar admins e outros super admins |
| Admin | criar, desativar e redefinir a senha de **editores** |
| Editor | usar a plataforma (sem a tela Usuários) |

O nome é o que aparece nas notas e mudanças de status que vão para o War.
Redefinir a senha de alguém derruba as sessões abertas daquela pessoa; desativar
tira o acesso na hora. Cada pessoa troca a própria senha no menu com o nome dela.

Pela linha de comando também: `user list`, `user passwd --email ...`,
`user disable --email ...` (`--enable` reativa).

## 8. Ligar o servidor (systemd)

Volte para root (`exit`) e rode:

```bash
cp /opt/vision/deploy/vision.service /etc/systemd/system/vision.service
systemctl daemon-reload
systemctl enable --now vision
systemctl status vision                       # "active (running)"
curl -s -o /dev/null -w '%{http_code}\n' localhost:4000/api/projects   # 401 = no ar e pedindo login
```

Logs: `journalctl -u vision -f`. Ao subir aparece
`Demandas: armazenamento Postgres (schema vision)`; se aparecer "local", o
`VISION_DATABASE_URL` não foi lido.

## 9. Caddy: domínio e HTTPS

```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy

cp /opt/vision/deploy/Caddyfile /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
```

O Caddy emite o certificado HTTPS sozinho no primeiro acesso (o DNS do passo 2
precisa já apontar para o servidor). Abra `https://vision.scalecompany.com.br` e
entre com um acesso do passo 7.

Depois, no topo da tela, clique em **Conectar Google Drive** e entre com a conta
da Scale que tem acesso às pastas de entrega.

## 10. Ligar o War

No War, configure o webhook de demandas para:

```
URL:     https://vision.scalecompany.com.br/api/webhooks/war
Header:  x-webhook-secret: <DEMANDAS_WEBHOOK_SECRET>
```

Teste: crie uma demanda de vídeo no War. Ela aparece no quadro em até 20 s, com
uma notificação no sino. Mude o status no Vision e confira no War.

## 11. Levar a biblioteca (obrigatório) e projetos antigos (opcional)

A biblioteca de assets (`media/library`, ~3 GB: ícones, personagens, fundos,
transições, texturas e os SFX) fica **fora do git**. Sem ela o editor abre,
mas a Biblioteca fica vazia, os motions ficam **sem som** e overlays de
projetos antigos que usam esses itens somem no render. Os motions em si
(animações, fontes, fundos animados da tela cheia) são código e vão pelo git.

Do Windows, no PowerShell, na pasta do VisionOS:

```powershell
scp -r media\library root@IP:/opt/vision/media/
scp -r media\projects root@IP:/opt/vision/media/   # só se quiser os projetos antigos
```

Depois, no servidor: `chown -R vision:vision /opt/vision/media && systemctl restart vision`.
O log da subida confirma: `Biblioteca: 1518 itens (159 SFX)` (com o pack atual). Se aparecer
**Biblioteca VAZIA**, a cópia não chegou em `/opt/vision/media/library`.

Os nomes de arquivo da biblioteca e dos projetos já batem exatamente (o Linux
diferencia maiúsculas; conferido). A biblioteca entra no backup diário do
passo 13, junto com o resto de `media/`.

O estilo das músicas (usado na escolha automática da trilha) já vai dentro de
`media/library/catalog.json`: não precisa analisar de novo na VPS. Só música
nova importada depois pede `npm run cli -- library music` (analisa apenas as
que faltam; usa `OPENAI_API_KEY`).

## 12. Limpeza automática de disco

Com `VISION_RETENTION=on`, o servidor roda a limpeza 1 minuto depois de subir e
a cada 6 horas:

- **bruto** apagado 10 dias depois da entrega no Drive (ou 30 dias sem edição,
  em projeto sem entrega);
- **renders antigos** apagados (fica só o mais recente).

Ficam a receita, a transcrição, os áudios, as miniaturas e o último render. Um
projeto com o bruto apagado abre para consulta, mas não renderiza de novo (o
editor avisa).

Ver antes o que seria apagado: `npm run cli -- retention --dry-run`.
Rodar na hora: `npm run cli -- retention` (ou `--project <id>` para um só).

### Render e disco temporário

O render do Remotion trabalha com um "bundle" (código das composições + a
pasta `media/`). Para o disco não encher:

- **Um bundle por processo**, feito na subida do servidor e reaproveitado por
  todos os renders (antes era um por render, e cada um levava `media/`
  inteira — encheu 76 GB num dia de testes no Windows).
- **No Linux a mídia entra como link** (`symlinkPublicDir`), sem cópia: o
  bundle fica com poucos MB.
- **Comandos pontuais** (`npm run cli -- render`, `motion-sheet`) apagam o
  bundle ao terminar; cada bundle guarda o PID do dono, e a **subida do
  servidor e a limpeza (`retention`) apagam os órfãos** (dono morto, ou
  pastas `remotion-*` sem dono com mais de 2 h).
- **Um render por vez** (fila): uso single-user e vídeo curto; render em
  paralelo dobraria CPU, RAM e temporários.
- **Folga mínima de 3 GB** livres para começar um render (senão o editor
  mostra o erro e pede a limpeza). Na VPS, deixe pelo menos 20 GB livres
  além de `media/`.
- Se o `/tmp` da VPS for em RAM (tmpfs), aponte o temporário para o disco no
  `vision.service`: `Environment=TMPDIR=/opt/vision/tmp` (e crie a pasta).

Ver o que está ocupando: `du -sh /tmp/remotion-* 2>/dev/null`.

## 13. Backup diário de `media/`

Usa o **restic** (criptografado, incremental, com versões) num bucket barato
compatível com S3 (Backblaze B2, Cloudflare R2, Wasabi…). O banco já tem o
backup do Supabase; aqui entram as receitas das edições, renders e o `.env`.
Os brutos ficam de fora (estão no Drive de Materiais do cliente).

1. No B2: crie um bucket **privado** e uma *Application Key* com acesso só a ele.
2. No servidor (root):

   ```bash
   cp /opt/vision/deploy/backup.env.example /etc/vision-backup.env
   chmod 600 /etc/vision-backup.env
   nano /etc/vision-backup.env       # repositório, chaves e uma senha longa

   set -a; source /etc/vision-backup.env; set +a
   restic init
   bash /opt/vision/deploy/backup.sh
   ```

3. Agende para todo dia às 4h:

   ```bash
   echo '0 4 * * * root bash /opt/vision/deploy/backup.sh >> /var/log/vision-backup.log 2>&1' > /etc/cron.d/vision-backup
   ```

> **Guarde a `RESTIC_PASSWORD` fora do servidor** (gerenciador de senhas). Sem
> ela não há como restaurar.

Teste a restauração uma vez:

```bash
set -a; source /etc/vision-backup.env; set +a
restic restore latest --target /tmp/teste-restore --include /opt/vision/media/projects
ls /tmp/teste-restore/opt/vision/media/projects && rm -rf /tmp/teste-restore
```

## 14. Atualizar o VISION

Depois de dar `git push` no seu computador:

```bash
ssh root@IP
sudo -iu vision bash /opt/vision/deploy/update.sh
```

O script baixa o código, instala as dependências, roda os testes, recompila a
interface e reinicia o serviço. Se um teste falhar, ele para antes de reiniciar.
Se a versão nova trouxer tabela nova, rode o `db/vision.sql` de novo no Supabase
antes (é seguro rodar de novo).

## Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Navegador avisa "conexão não segura" | Certificado ainda não emitido | `journalctl -u caddy -n 50`: confira o DNS e as portas 80/443 |
| 502 Bad Gateway | Node parado | `systemctl status vision` e `journalctl -u vision -n 100` |
| `ENETUNREACH` com endereço IPv6 | `VISION_DATABASE_URL` usa `db.<ref>.supabase.co` | Use o pooler compartilhado (passo 5) |
| `relation "vision.users" does not exist` | Tabela nova não criada | Rode `db/vision.sql` de novo no Supabase |
| "muitas tentativas; espere 10 minutos" | 5 senhas erradas seguidas | Espere, ou troque a senha: `npm run cli -- user passwd --email ...` |
| Todos deslogam a cada reinício | `VISION_SESSION_SECRET` ausente | Defina no `.env` (passo 6) e reinicie |
| Demanda do War não chega | Segredo diferente ou URL errada | `journalctl -u vision -f` enquanto o War envia; confira o `DEMANDAS_WEBHOOK_SECRET` dos dois lados |
| "Conectar Google Drive" volta com erro | Redirecionamento não autorizado | Inclua `https://vision.scalecompany.com.br/api/google/callback` no OAuth Client |
| Render falha com erro de biblioteca `.so` | Faltou dependência do Chrome | Repita o `apt install` do passo 3 |
| Emoji vira quadrado no MP4 | Falta a fonte de emoji | `apt install fonts-noto-color-emoji` e reinicie o vision |
| Disco enchendo | Limpeza desligada | `VISION_RETENTION=on` no `.env`; `npm run cli -- retention --dry-run` mostra o que sairia |
