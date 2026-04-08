#!/bin/bash

echo "================================"
echo "🧪 TESTE COMPLETO DO SISTEMA"
echo "================================"
echo ""

echo "✅ Teste 1: Verificação de Arquivos"
echo "-----------------------------------"
files=("monitor.ts" "whm-extractor.ts" "test-whm.ts" "index.html" "status.json" "tsconfig.json" "package.json")
for file in "${files[@]}"; do
    if [ -f "$file" ]; then
        size=$(du -h "$file" | cut -f1)
        echo "  ✓ $file ($size)"
    else
        echo "  ✗ $file (FALTANDO)"
    fi
done
echo ""

echo "✅ Teste 2: Verificação de Dependências Node.js"
echo "----------------------------------------------"
echo "  Node.js: $(node --version)"
echo "  npm: $(npm --version)"
echo ""

echo "✅ Teste 3: Validação TypeScript"
echo "-------------------------------"
if npm run typecheck >/dev/null 2>&1; then
    echo "  ✓ TypeScript check válido"
else
    echo "  ✗ TypeScript check com erros"
fi
echo ""

echo "✅ Teste 4: Estrutura de Dados JSON"
echo "-----------------------------------"
if node -e "require('fs').readFileSync('status.json', 'utf8'); console.log('✓ status.json válido')" 2>/dev/null; then
    entries=$(node -e "const d = JSON.parse(require('fs').readFileSync('status.json', 'utf8')); console.log(d.checks.length);" 2>/dev/null)
    echo "  ✓ status.json contém $entries entradas de histórico"
else
    echo "  ✗ status.json inválido"
fi
echo ""

echo "✅ Teste 5: Verificação de Módulos"
echo "---------------------------------"
if node -e "require('ts-node/register'); const m = require('./monitor.ts'); console.log('✓ monitor.ts exporta:', Object.keys(m).join(', '))" 2>/dev/null; then
    echo ""
else
    echo "  ⚠ Aviso no módulo"
fi
echo ""

echo "✅ Teste 6: Execução do Monitor (sem WHM)"
echo "----------------------------------------"
if WHM_ENABLED=false MONITOR_TIMEOUT_MS=3000 MONITOR_MAX_RETRIES=0 MONITOR_PARALLEL_LIMIT=50 timeout 120 npm run monitor >/tmp/monitor-test.log 2>&1; then
    tail -10 /tmp/monitor-test.log
    echo "  ✓ Monitor executado com sucesso"
else
    tail -20 /tmp/monitor-test.log
    echo "  ✗ Falha ao executar monitor"
fi
echo ""

echo "✅ Teste 7: Build do Frontend"
echo "-----------------------------"
if npm --prefix frontend run build >/tmp/frontend-build.log 2>&1; then
    echo "  ✓ Build do frontend concluído"
    if [ -f frontend/dist/index.html ]; then
        echo "  ✓ frontend/dist/index.html gerado"
    else
        echo "  ✗ frontend/dist/index.html não encontrado"
    fi
    if [ -f frontend/dist/status.json ]; then
        echo "  ✓ frontend/dist/status.json gerado"
    else
        echo "  ⚠ frontend/dist/status.json não encontrado"
    fi
else
    tail -20 /tmp/frontend-build.log
    echo "  ✗ Build do frontend falhou"
fi
echo ""

echo "✅ Teste 8: Configuração de Ambiente"
echo "-----------------------------------"
if [ -n "$WHM_API_TOKEN" ]; then
    echo "  • WHM_API_TOKEN: (configurado)"
else
    echo "  • WHM_API_TOKEN: (não configurado)"
fi
echo "  • VITE_SUPABASE_URL: ${VITE_SUPABASE_URL:-(não configurado)}"
echo ""

echo "================================"
echo "✨ TESTES CONCLUÍDOS"
echo "================================"
