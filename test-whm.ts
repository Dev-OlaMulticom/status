import { extractAccountsAndDomains, testConnection } from './whm-extractor';

console.log('🧪 TESTE DE INTEGRAÇÃO WHM\n');
console.log('═'.repeat(50));

async function runTests(): Promise<void> {
    try {
        console.log('\n1️⃣ Testando configuração de ambiente...');
        console.log(`   WHM_API_TOKEN: ${process.env.WHM_API_TOKEN ? '✓ Presente' : '✗ Ausente'}`);

        console.log('\n2️⃣ Testando conexão com WHM...');
        const connectionTest = await testConnection();

        if (connectionTest) {
            console.log('\n3️⃣ Extraindo dados de domínios...');
            const data = await extractAccountsAndDomains();

            console.log('\n   📊 Estatísticas:');
            console.log(`   • Domínios encontrados: ${data.domains.length}`);
            console.log(`   • Contas encontradas: ${data.accounts.length}`);

            if (data.domains.length > 0) {
                console.log('\n   📋 Primeiros 5 domínios:');
                data.domains.slice(0, 5).forEach((domain, idx) => {
                    console.log(`   ${idx + 1}. ${domain.domain}`);
                    console.log(`      • Conta: ${domain.username}`);
                    console.log(`      • Tipo: ${domain.type}`);
                    console.log(`      • Status: ${domain.status}`);
                });

                if (data.domains.length > 5) {
                    console.log(`   ... e mais ${data.domains.length - 5} domínios`);
                }
            }

            console.log('\n✅ Teste concluído com sucesso!');
        } else {
            console.log('\n❌ Falha na conexão com WHM');
            process.exit(1);
        }
    } catch (error: any) {
        console.error('\n❌ Erro durante o teste:', error.message);
        process.exit(1);
    }
}

runTests();
