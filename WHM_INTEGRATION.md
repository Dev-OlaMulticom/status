# Integração WHM - Documentação Técnica

## Visão Geral

O sistema foi configurado para integrar-se com o ServoLam (WHM) através do endpoint:
```
https://servolam.olamulticom.com.br:2087/json-api/get_domain_info?api.version=1
```

## Arquitetura

### Componentes Principais

1. **monitor.js** - Script principal de monitoramento
   - Gerencia ciclo de vida de verificações
   - Sincroniza domínios do WHM a cada hora
   - Gera página HTML com status dos sites

2. **whm-extractor.js** - Módulo de integração WHM
   - Conecta ao endpoint do ServoLam
   - Extrai informações de domínios e contas
   - Classifica domínios por tipo (principal, addon, subdomínio)
   - Tratamento de erros e timeouts

3. **test-whm.js** - Script de teste
   - Verifica configuração de ambiente
   - Testa conexão com WHM
   - Exibe estatísticas de domínios

## Fluxo de Operação

```
┌─────────────────────────────────────────────┐
│ GitHub Actions (a cada 5 minutos)           │
└──────────────────┬──────────────────────────┘
                   │
                   ▼
         ┌─────────────────────┐
         │ monitor.js inicia   │
         └──────────┬──────────┘
                    │
         ┌──────────▼──────────┐
         │ Verifica sites      │
         │ manuais (4 sites)   │
         └──────────┬──────────┘
                    │
         ┌──────────▼──────────────┐
         │ A cada 1 hora:          │
         │ Sincroniza com WHM      │
         └──────────┬──────────────┘
                    │
         ┌──────────▼──────────┐
         │ whm-extractor.js    │
         │ extrai domínios     │
         └──────────┬──────────┘
                    │
         ┌──────────▼──────────┐
         │ Monitora domínios   │
         │ do WHM              │
         └──────────┬──────────┘
                    │
         ┌──────────▼──────────┐
         │ Gera status.json    │
         │ Gera index.html     │
         └──────────┬──────────┘
                    │
         ┌──────────▼──────────┐
         │ Deploy GitHub Pages │
         └─────────────────────┘
```

## Configuração Necessária

### GitHub Secrets

Adicionar o seguinte secret ao repositório:

**Nome:** `WHM_API_TOKEN`
**Valor:** Token de API do WHM (deve ser fornecido)

Para adicionar:
1. Acesse: Settings > Secrets and variables > Actions
2. Clique "New repository secret"
3. Nome: `WHM_API_TOKEN`
4. Crie o token

### Variáveis de Ambiente

O script usa:
- `WHM_API_TOKEN` - Token de autenticação (obrigatório)

### Arquivos Modificados

#### monitor.js
- Integrado suporte a sincronização WHM
- Lógica de agendamento: verifica a cada 5 min, sincroniza a cada hora
- Tratamento de erros para sincronização

#### whm-extractor.js (NOVO)
- Conexão HTTPS ao ServoLam
- Parser de resposta JSON
- Classificação automática de domínios
- Tratamento de timeouts

## API do WhM-Extractor

```javascript
const whmExtractor = require('./whm-extractor');

// Extrair todos os domínios e contas
const data = await whmExtractor.extractAccountsAndDomains();
// Retorna: { domains: [], accounts: [], timestamp: '' }

// Testar conexão
const isConnected = await whmExtractor.testConnection();
// Retorna: true ou false

// Fazer requisição customizada
const result = await whmExtractor.makeWHMRequest('get_domain_info', {
    search: 'example'
});
```

## Estrutura de Dados

### Domínio
```javascript
{
  domain: "example.com",
  username: "user123",
  status: "Activa" | "Suspensa",
  type: "principal" | "addon" | "subdominio",
  mainDomain: "example.com",
  ip: "1.2.3.4",
  addon: false,
  subdomain: false
}
```

### Conta
```javascript
{
  username: "user123",
  domains: ["example.com", "example2.com"],
  suspended: false
}
```

## Filtros Aplicados

Por padrão, o monitor exclui:
- Domínios de controle (cpanel.*, webmail.*, mail.*, ftp.*, autodiscover.*)
- Domínios suspendidos

Pode incluir:
- Subdomínios
- Addon domains

## Testes

### Executar teste de conexão
```bash
WHM_API_TOKEN=seu_token node test-whm.js
```

### Executar monitoramento completo
```bash
WHM_API_TOKEN=seu_token node monitor.js
```

## Arquivos Gerados

- **status.json** - Histórico de verificações (últimas 100)
- **index.html** - Página de status
- **sites-config.json** - Configuração de sitios (se criado)

## Tratamento de Erros

### Token não configurado
- O monitor continua funcionando com sites manuais
- Exibe aviso de sincronização falhada

### Conexão com WHM falhada
- Preserva dados anteriores de sincronização
- Tenta novamente na próxima hora
- Não interrompe verificação de sites manuais

### Timeout
- Configurado para 10 segundos
- Registra erro específico
- Tenta novamente na próxima sincronização

## Próximos Passos

1. ✅ Módulo WHM criado (whm-extractor.js)
2. ✅ Integração com monitor.js completa
3. ✅ Script de teste criado
4. ⏳ Adicionar WHM_API_TOKEN ao GitHub Secrets
5. ⏳ Testar sincronização completa com dados reais

## Status Atual

- ✅ Monitor de sites manuais: Funcionando
- ✅ Extração de domínios WHM: Implementada
- ⏳ Integração WHM: Aguardando token de API
- ✅ GitHub Actions: Configurado para rodar

