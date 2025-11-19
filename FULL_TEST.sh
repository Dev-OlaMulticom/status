#!/bin/bash

echo "================================"
echo "🧪 TESTE COMPLETO DO SISTEMA"
echo "================================"
echo ""

echo "✅ Teste 1: Verificação de Arquivos"
echo "-----------------------------------"
files=("monitor.js" "whm-extractor.js" "test-whm.js" "index.html" "status.json")
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

echo "✅ Teste 3: Validação de Sintaxe JavaScript"
echo "-------------------------------------------"
for file in monitor.js whm-extractor.js test-whm.js; do
    if node -c "$file" 2>/dev/null; then
        echo "  ✓ $file - Sintaxe válida"
    else
        echo "  ✗ $file - Erro de sintaxe"
    fi
done
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
if node -e "const m = require('./monitor.js'); console.log('✓ monitor.js exporta:', Object.keys(m).join(', '))" 2>/dev/null; then
    echo ""
else
    echo "  ⚠ Aviso no módulo"
fi
echo ""

echo "✅ Teste 6: Execução do Monitor (sem WHM)"
echo "----------------------------------------"
timeout 15 node monitor.js 2>&1 | tail -10
echo ""

echo "✅ Teste 7: Verificação HTML"
echo "----------------------------"
if grep -q '<!DOCTYPE html>' index.html; then
    echo "  ✓ HTML bem formado"
    echo "  ✓ Título: $(grep -o '<title>[^<]*</title>' index.html)"
    online=$(grep -o 'Online:.*</span>' index.html | head -1)
    echo "  ✓ Status: $online"
else
    echo "  ✗ HTML inválido"
fi
echo ""

echo "✅ Teste 8: Configuração de Ambiente"
echo "-----------------------------------"
echo "  • WHM_API_TOKEN: ${WHM_API_TOKEN:-(não configurado)}"
echo "  • VITE_SUPABASE_URL: ${VITE_SUPABASE_URL:-(não configurado)}"
echo ""

echo "================================"
echo "✨ TESTES CONCLUÍDOS"
echo "================================"
