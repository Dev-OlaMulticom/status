# Guia de Setup - Monitor de Websites

## 🚀 Início Rápido

O sistema está **100% pronto para uso**. Siga estes passos para ativar a integração completa com o WHM.

---

## 📋 Pré-requisitos

- ✅ Node.js 20+ instalado
- ✅ Repositório GitHub (com CI/CD configurado)
- ✅ Token de API do ServoLam (WHM)

---

## ⚙️ Configuração

### Passo 1: Obter Token WHM

1. Acesse o ServoLam: `https://servolam.olamulticom.com.br:2087`
2. Faça login como root
3. Acesse: **Home** > **Developers** ou **API Tokens**
4. Gere um novo token ou copie o existente
5. Copie o valor do token (será usado no passo 2)

### Passo 2: Adicionar Secret ao GitHub

1. Acesse seu repositório no GitHub
2. Vá para **Settings** > **Secrets and variables** > **Actions**
3. Clique em **New repository secret**
4. Preencha:
   - **Name:** `WHM_API_TOKEN`
   - **Secret:** (Cole o token do passo 1)
5. Clique em **Add secret**

### Passo 3: Verificar Workflow

1. Acesse a aba **Actions** do repositório
2. Selecione o workflow **Website Status Monitor**
3. Clique em **Run workflow** para executar imediatamente
4. Monitore a execução na aba de logs

---

## 🧪 Testes Locais

### Teste 1: Validação do Ambiente

```bash
# Verificar que o token está disponível
export WHM_API_TOKEN="seu_token_aqui"
node test-whm.js
```

Resultado esperado:
```
🧪 TESTE DE INTEGRAÇÃO WHM
...
✅ Teste concluído com sucesso!
```

### Teste 2: Execução Completa

```bash
export WHM_API_TOKEN="seu_token_aqui"
node monitor.js
```

Resultado esperado:
```
🚀 Iniciando Monitor Integrado...
🔄 Sincronizando con WHM...
🔗 Conectando com WHM...
✅ Extraídos X domínios de Y contas
🔍 Verificando Z sitios...
📊 RESUMEN:
✅ Online: Z
...
✨ Monitor completado exitosamente!
```

### Teste 3: Validação de Arquivos Gerados

```bash
# Verificar que foram criados
ls -la index.html status.json sites-config.json

# Ver últimas entradas do histórico
node -e "
  const fs = require('fs');
  const data = JSON.parse(fs.readFileSync('status.json', 'utf8'));
  console.log('Últimas 3 verificações:');
  data.checks.slice(0, 3).forEach((check, i) => {
    console.log(\`  \${i+1}. \${check.timestamp}\`);
    console.log(\`     Online: \${check.results.filter(r => r.online).length}\`);
  });
"
```

---

## 📊 Visualizar Dashboard

### Local

```bash
# Abrir em navegador (se tiver um servidor local)
open index.html

# Ou use um servidor Python
python3 -m http.server 8000
# Acesse: http://localhost:8000
```

### Online (GitHub Pages)

Após o primeiro workflow bem-sucedido:
```
https://seu-usuario.github.io/seu-repositorio/
```

---

## 📈 Monitorando o Sistema

### Status em Tempo Real

O workflow executa automaticamente:
- **A cada 5 minutos** - Verifica todos os sites
- **A cada 1 hora** - Sincroniza domínios do WHM
- **24/7** - Dashboard em GitHub Pages atualiza

### Acessar Logs

1. GitHub > Actions > Website Status Monitor
2. Selecione a execução
3. Veja detalhes em **Jobs** > **monitor**

### Interpretar Resultados

```
✅ Online: N      → Quantidade de sites online
❌ Offline: M     → Quantidade de sites offline
📝 Manuales: X    → Sites configurados manualmente
🌐 WHM: Y         → Domínios sincronizados do WHM
📊 Uptime: P%     → Porcentagem de tempo online
```

---

## 🔧 Configurações Avançadas

### Ajustar Intervalo de Sincronização

Edite `monitor.js`, linha 322:

```javascript
// Padrão: 1 hora
const syncThreshold = 60 * 60 * 1000; // ms

// Exemplo: 30 minutos
const syncThreshold = 30 * 60 * 1000;
```

### Adicionar Mais Sites Manuais

Edite `monitor.js`, linha 19-24:

```javascript
const MANUAL_SITES = [
    { name: 'Seu Site 1', url: 'https://seu-site-1.com' },
    { name: 'Seu Site 2', url: 'https://seu-site-2.com' },
    // Adicione mais sites aqui
];
```

### Configurar Filtros de Domínios WHM

Edite `monitor.js`, linha 32-44:

```javascript
const WHM_CONFIG = {
    filters: {
        excludeSuspended: true,        // Excluir domínios suspensos
        excludeSubdomains: false,      // Excluir subdomínios
        excludeAddonDomains: false,    // Excluir addon domains
        onlyMainDomains: false,        // Apenas domínios principais
        excludePatterns: [
            'cpanel.', 'webmail.', 'mail.', 'ftp.', 'autodiscover.'
        ]
    }
};
```

### Aumentar Timeout

Edite `monitor.js`, linha 48:

```javascript
const MONITOR_CONFIG = {
    timeout: 10000, // Padrão: 10 segundos
    // Aumentar para 15 segundos:
    timeout: 15000,
};
```

---

## 🐛 Troubleshooting

### Problema: "WHM_API_TOKEN não configurado"

**Solução:**
1. Verificar se o secret foi adicionado ao GitHub
2. Verificar digitação exata: `WHM_API_TOKEN`
3. Aguardar 1-2 minutos após adicionar (cache)
4. Re-executar o workflow

### Problema: "Erro de conexão com WHM"

**Solução:**
1. Verificar conectividade: `ping servolam.olamulticom.com.br`
2. Verificar token válido no ServoLam
3. Verificar firewall/proxy bloqueando porta 2087
4. Testar localmente: `WHM_API_TOKEN=seu_token node test-whm.js`

### Problema: "Nenhum domínio sincronizado"

**Solução:**
1. Verificar se há domínios na conta WHM
2. Verificar filtros de domínios em `monitor.js`
3. Verificar logs: GitHub Actions > Detalhes

### Problema: Workflow falhando

**Solução:**
1. Clicar em **Re-run jobs** no GitHub
2. Verificar logs em detalhes
3. Verificar mudanças recentes no código
4. Restaurar versão anterior se necessário

---

## ✅ Checklist Final

- [ ] Token WHM obtido
- [ ] Secret adicionado ao GitHub
- [ ] Teste local passou: `node test-whm.js`
- [ ] Workflow executado com sucesso
- [ ] Dashboard visível no GitHub Pages
- [ ] Domínios do WHM aparecem no dashboard
- [ ] Histórico de verificações salvo

---

## 📞 Suporte

### Logs Importantes

Localização local:
- Stdout/Stderr: console do terminal
- Histórico: `status.json`
- Config: `sites-config.json`
- Dashboard: `index.html`

Localização GitHub:
- Logs de execução: Actions > Workflow runs
- Commit history: Commits com "🔍 Update website status"

### Referências

- [Documentação WHM API](https://documentation.cpanel.net/display/DD/JSON-API)
- [GitHub Actions Secrets](https://docs.github.com/en/actions/security-guides/using-secrets-in-github-actions)
- [GitHub Pages](https://pages.github.com/)

---

## 🎉 Pronto!

O sistema está configurado e pronto para monitorar seus websites e domínios WHM 24/7.

**Próxima execução:** Em até 5 minutos

