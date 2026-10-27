// Confere o config.js EXTRAÍDO DO APK assinado. Não executa o arquivo.
import { readFileSync } from 'node:fs';
const source = readFileSync(process.argv[2], 'utf8');
const config = JSON.parse(/Object\.freeze\((\{[^\n]*\})\);/.exec(source)?.[1] ?? 'null');
if (!config || config.devBuild !== false || config.testHooks !== false || config.serviceWorker !== false || !/^https:\/\//.test(config.api) || /-dev$/.test(config.versionCode)) throw new Error('APK recusado: configuração de produção inválida ou diagnóstico ativo');
console.log('Configuração do APK aprovada: produção, sem hooks nem console de diagnóstico.');
