# Escuta GPECSS

Ferramenta de acessibilidade do GPECSS: transforma textos (PDF, Word .docx, TXT, Markdown, HTML) em áudio MP3 com voz neural, sem enviar nada para servidores.

## Etapas
1. **Leitura do arquivo** (`js/extrair.js`): PDF via pdf.js, Word via mammoth.
2. **Adaptação para escuta** (`js/adaptar.js`): remove símbolos, emojis, números de página, marcas de nota e cabeçalhos repetidos; transforma abreviaturas, datas, horas, porcentagens, valores, ordinais, romanos e siglas em fala natural; avisa tabelas; pode pular as referências.
3. **Voz** (`js/voz-worker.js`): Piper, voz pt-BR "Faber" (medium), rodando em WebAssembly (onnxruntime-web), em várias linhas de produção em paralelo.
4. **Lapidação** (`js/lapidar.js`): pausas sob medida, corte de silêncios, filtro de graves, corpo, clareza, suavização de agudos, compressão, ambiente, volume uniforme e tom, em trechos de 3 minutos, e conversão para MP3 (lamejs).

## Publicação
Site estático (GitHub Pages). No Wix, o acesso é por botão que abre a ferramenta numa nova guia, porque a caixa HTML do Wix bloqueia downloads.

## Créditos e licenças
- Piper (MIT) e voz pt_BR-faber-medium (modelos Piper, licença aberta indicada no cartão do modelo).
- Fonemizador piper-phonemize/espeak-ng (GPL-3.0), carregado de `@diffusionstudio/piper-wasm`. Carregador em `vendor/piper_phonemize.js`, a partir de `@mintplex-labs/piper-tts-web` (MIT).
- onnxruntime-web (MIT), pdf.js (Apache-2.0), mammoth (BSD-2), lamejs (LGPL-3.0).
