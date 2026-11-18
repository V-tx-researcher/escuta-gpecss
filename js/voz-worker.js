/* Escuta GPECSS — motor de voz (Piper / Faber) rodando num Worker clássico.
   Tudo acontece no computador da pessoa: o texto nunca sai do navegador. */
'use strict';

const ORT_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.18.0/';
const PHON_BASE = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize';
const VOZ_BASE = 'https://huggingface.co/diffusionstudio/piper-voices/resolve/main/pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx';
const CACHE = 'escuta-gpecss-voz-v1';

importScripts(ORT_BASE + 'ort.wasm.min.js', '../vendor/piper_phonemize.js');

let sessao = null;
let config = null;
let pronto = null;

function avisar(msg) { self.postMessage(msg); }

async function baixarComProgresso(url, rotulo) {
  let cache = null;
  try { cache = await caches.open(CACHE); } catch (e) { cache = null; }
  if (cache) {
    const salvo = await cache.match(url);
    if (salvo) return new Uint8Array(await salvo.arrayBuffer());
  }
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('Falha ao baixar ' + rotulo + ' (' + resp.status + ')');
  const total = Number(resp.headers.get('content-length')) || 0;
  const leitor = resp.body.getReader();
  const partes = [];
  let recebido = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    partes.push(value);
    recebido += value.length;
    avisar({ tipo: 'download', rotulo, recebido, total });
  }
  const dados = new Uint8Array(recebido);
  let p = 0;
  for (const parte of partes) { dados.set(parte, p); p += parte.length; }
  if (cache) {
    try { await cache.put(url, new Response(dados.slice().buffer)); } catch (e) { /* sem espaço: segue sem guardar */ }
  }
  return dados;
}

async function iniciar() {
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = ORT_BASE;
  const cfg = await baixarComProgresso(VOZ_BASE + '.json', 'configuração');
  config = JSON.parse(new TextDecoder().decode(cfg));
  const modelo = await baixarComProgresso(VOZ_BASE, 'voz');
  avisar({ tipo: 'estado', texto: 'Preparando a voz…' });
  sessao = await ort.InferenceSession.create(modelo, { executionProviders: ['wasm'] });
  avisar({ tipo: 'pronto', taxa: config.audio.sample_rate });
}

/* Converte várias frases em fonemas numa única chamada ao espeak. */
function fonemizar(frases) {
  return new Promise((resolve, reject) => {
    const saidas = [];
    createPiperPhonemize({
      print: (linha) => {
        try { saidas.push(JSON.parse(linha).phoneme_ids); } catch (e) { /* ignora */ }
        if (saidas.length === frases.length) resolve(saidas);
      },
      printErr: (m) => { if (/error/i.test(m)) reject(new Error(m)); },
      locateFile: (u) => (u.endsWith('.wasm') ? PHON_BASE + '.wasm' : u.endsWith('.data') ? PHON_BASE + '.data' : u),
    }).then((mod) => {
      const entrada = JSON.stringify(frases.map((t) => ({ text: t })));
      setTimeout(() => { if (saidas.length < frases.length) resolve(saidas); }, 4000);
      try {
        mod.callMain(['-l', config.espeak.voice, '--input', entrada, '--espeak_data', '/espeak-ng-data']);
      } catch (e) { resolve(saidas); }
    }, reject);
  });
}

async function falar(ids, escalas) {
  const feeds = {
    input: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)])),
    scales: new ort.Tensor('float32', Float32Array.from([escalas.noise, escalas.length, escalas.noiseW])),
  };
  const out = await sessao.run(feeds);
  return out.output.data;
}

let cancelado = new Set();

self.onmessage = async (ev) => {
  const m = ev.data;
  try {
    if (m.tipo === 'iniciar') {
      if (!pronto) pronto = iniciar();
      await pronto;
    } else if (m.tipo === 'cancelar') {
      cancelado.add(m.id);
    } else if (m.tipo === 'sintetizar') {
      await pronto;
      const LOTE = 12;
      for (let ini = 0; ini < m.frases.length; ini += LOTE) {
        if (cancelado.has(m.id)) return;
        const lote = m.frases.slice(ini, ini + LOTE);
        let ids = await fonemizar(lote);
        if (ids.length !== lote.length) {
          ids = [];
          for (const f of lote) ids.push((await fonemizar([f]))[0] || []);
        }
        for (let k = 0; k < lote.length; k++) {
          if (cancelado.has(m.id)) return;
          const i = ini + k;
          let pcm = new Float32Array(0);
          if (ids[k] && ids[k].length > 2) pcm = await falar(ids[k], m.escalas);
          const copia = new Float32Array(pcm);
          self.postMessage({ tipo: 'audio', id: m.id, i: m.indices ? m.indices[i] : i, pcm: copia }, [copia.buffer]);
        }
      }
      self.postMessage({ tipo: 'fim', id: m.id });
    }
  } catch (e) {
    avisar({ tipo: 'erro', id: m.id, texto: String(e && e.message || e) });
  }
};
