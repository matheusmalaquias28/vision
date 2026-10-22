# Publicando o VISION num VPS

Passo a passo para rodar o VISION num servidor próprio (Ubuntu 24.04), com
domínio, HTTPS, senha na entrada, a chave da OpenAI e backup diário de `media/`.

Como fica:

```
navegador ──HTTPS──► Caddy (443) ── senha ──┬─► /api, /projects, /music, /sfx, /library ─► Node :4000 (systemd)
                                             └─► resto: apps/web/dist (interface já compilada)
```

Os arquivos prontos estão em [`deploy/`](deploy/). Troque `vision.seudominio.com.br`
pelo seu domínio em todos os comandos.

> **Importante:** o VISION não tem login próprio. Quem tiver o endereço usa sua
> chave da OpenAI e mexe nos seus projetos. A senha do passo 7 é obrigatória.

---

## 1. Contratar o servidor

| | Mínimo | Recomendado |
|---|---|---|
| CPU | 2 vCPU | **4 vCPU** (o render do Remotion usa todos) |
| Memória | 4 GB | **8 GB** |
| Disco SSD | 60 GB | **100 GB+** (biblioteca ~3 GB + ~70 MB por projeto + renders) |
| Sistema | Ubuntu 24.04 LTS | |

- **Região:** os brutos sobem do seu computador, às vezes com vários GB. Um
  servidor em São Paulo (Vultr, Hostinger, AWS Lightsail, Magalu Cloud…) deixa o
  upload bem mais rápido. Na Europa (Hetzner) costuma ser mais barato e funciona,
  só que o upload é mais lento.
- Na criação, cadastre sua **chave SSH** em vez de senha. No Windows:
  `ssh-keygen -t ed25519` e cole o conteúdo de `C:\Users\<você>\.ssh\id_ed25519.pub`.

Anote o **IP público** do servidor.

## 2. Apontar o domínio

No painel onde o domínio está registrado (Registro.br, Cloudflare…), crie:

| Tipo | Nome | Valor |
|---|---|---|
| A | `vision` | IP do servidor |

> Na Cloudflare, deixe a nuvem **cinza** (só DNS). Com o proxy laranja, uploads
> grandes esbarram no limite de 100 MB por requisição do plano gratuito.

Confira (pode levar alguns minutos):

```bash
nslookup vision.seudominio.com.br
```

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
Sem ele, o Chrome do servidor desenha quadradinhos.

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

Se o repositório for **privado**, o `git clone` pede autenticação. Crie um
*fine-grained token* no GitHub (Settings → Developer settings) só com leitura
deste repositório e use-o como senha. Outra opção é uma *deploy key* SSH
(Settings do repositório → Deploy keys).

## 5. Chave da OpenAI

Ainda como `vision`:

```bash
cp .env.example .env
nano .env          # cole a OPENAI_API_KEY
chmod 600 .env
```

Recomendado: crie uma **chave só para o servidor**
(platform.openai.com → API keys) e defina um **limite de gasto mensal** no
projeto da OpenAI. Se a chave vazar, o prejuízo fica limitado e você revoga só
ela.

## 6. Ligar o servidor (systemd)

Volte para root (`exit`) e rode:

```bash
cp /opt/vision/deploy/vision.service /etc/systemd/system/vision.service
systemctl daemon-reload
systemctl enable --now vision
systemctl status vision          # deve estar "active (running)"
curl -s localhost:4000/api/projects   # [] num servidor novo
```

Logs: `journalctl -u vision -f`.

## 7. Caddy: domínio, HTTPS e senha

```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy

# gere o hash da senha de acesso (digite a senha quando pedir)
caddy hash-password
```

Copie o modelo e edite o **domínio** e o **hash** gerado acima:

```bash
cp /opt/vision/deploy/Caddyfile /etc/caddy/Caddyfile
nano /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
```

O Caddy emite o certificado HTTPS (Let's Encrypt) sozinho no primeiro acesso.
Para isso, o DNS do passo 2 precisa já apontar para o servidor e as portas 80 e
443 precisam estar abertas.

Abra `https://vision.seudominio.com.br`. O navegador pede usuário (`operador`)
e a senha.

## 8. Levar seus projetos e a biblioteca

Os projetos e a biblioteca de assets ficam fora do git (`media/projects`,
`media/library`). Do seu Windows, no PowerShell, na pasta do VisionOS:

```powershell
scp -r media\projects media\library media\sfx root@IP:/opt/vision/media/
```

São ~3,7 GB hoje; pode demorar. Depois, no servidor:

```bash
chown -R vision:vision /opt/vision/media
systemctl restart vision
```

Os caminhos nas receitas são relativos (`media/projects/...`), então os
projetos abrem sem ajuste.

## 9. Backup diário de `media/`

O backup usa o **restic**, que é criptografado, incremental e guarda versões, com
um bucket barato de armazenamento compatível com S3. O exemplo usa
**Backblaze B2**; Cloudflare R2, Wasabi e a Storage Box da Hetzner também
servem.

1. No B2: crie um bucket **privado** e uma *Application Key* com acesso só a ele.
2. No servidor (root):

   ```bash
   cp /opt/vision/deploy/backup.env.example /etc/vision-backup.env
   chmod 600 /etc/vision-backup.env
   nano /etc/vision-backup.env       # repositório, chaves e uma senha longa

   # cria o repositório (uma vez)
   set -a; source /etc/vision-backup.env; set +a
   restic init

   # primeiro backup (o maior)
   bash /opt/vision/deploy/backup.sh
   ```

3. Agende para todo dia às 4h:

   ```bash
   echo '0 4 * * * root bash /opt/vision/deploy/backup.sh >> /var/log/vision-backup.log 2>&1' > /etc/cron.d/vision-backup
   ```

> **Guarde a `RESTIC_PASSWORD` fora do servidor** (gerenciador de senhas). Sem
> ela não há como restaurar.

O que entra: `media/` inteira e o `.env`. O que fica de fora: caches que o
VISION gera de novo (waveforms, filmstrips, miniaturas). Política: 7 cópias
diárias, 4 semanais e 6 mensais.

**Teste a restauração** uma vez, logo depois do primeiro backup:

```bash
set -a; source /etc/vision-backup.env; set +a
restic snapshots
restic restore latest --target /tmp/teste-restore --include /opt/vision/media/projects
ls /tmp/teste-restore/opt/vision/media/projects && rm -rf /tmp/teste-restore
```

## 10. Atualizar o VISION

Depois de dar `git push` no seu computador:

```bash
ssh root@IP
sudo -iu vision bash /opt/vision/deploy/update.sh
```

O script baixa o código, instala as dependências, roda os testes, recompila a
interface e reinicia o serviço. Se um teste falhar, ele para antes de reiniciar.

## Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Navegador avisa "conexão não segura" | Certificado ainda não emitido | `journalctl -u caddy -n 50`: confira o DNS e as portas 80/443 |
| 502 Bad Gateway | Node parado | `systemctl status vision` e `journalctl -u vision -n 100` |
| Render falha com erro de biblioteca `.so` | Faltou dependência do Chrome | Repita o `apt install` do passo 3 |
| Emoji vira quadrado no MP4 | Falta a fonte de emoji | `apt install fonts-noto-color-emoji` e reinicie o vision |
| Transcrição falha com 401 | Chave da OpenAI errada ou revogada | Confira o `/opt/vision/.env` e reinicie o vision |
| Disco enchendo | Renders acumulando | `du -sh /opt/vision/media/projects/*/renders`: apague os antigos |
