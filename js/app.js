import { adaptarTexto, PRONUNCIAS_PADRAO } from './adaptar.js';
import { extrair } from './extrair.js';
import { aparar, montar, lapidar, criarMp3, wav, paraInt16, TAXA } from './lapidar.js';

const $ = (id) => document.getElementById(id);

const PRESETS = {
  padrao:     { nome: 'Padrão GPECSS', desc: 'equilibrada para textos acadêmicos', vel: 0.95, tom: 1, expr: 0.62, ritmo: 0.8, pausas: 1, corpo: 3, clareza: 1.5, ambiente: 0.06, uniforme: true },
  estudo:     { nome: 'Estudo tranquilo', desc: 'mais devagar, pausas longas', vel: 0.85, tom: 1, expr: 0.55, ritmo: 0.7, pausas: 1.4, corpo: 3, clareza: 1.5, ambiente: 0.05, uniforme: true },
  rapida:     { nome: 'Revisão rápida', desc: 'mais ágil, pausas curtas', vel: 1.2, tom: 1, expr: 0.6, ritmo: 0.8, pausas: 0.6, corpo: 2, clareza: 2, ambiente: 0, uniforme: true },
  expressiva: { nome: 'Expressiva', desc: 'entonação mais viva', vel: 0.95, tom: 1.02, expr: 0.82, ritmo: 1.0, pausas: 1.1, corpo: 3, clareza: 2, ambiente: 0.08, uniforme: true },
  clara:      { nome: 'Clareza máxima', desc: 'para baixa audição', vel: 0.85, tom: 1, expr: 0.5, ritmo: 0.7, pausas: 1.3, corpo: 0, clareza: 5, ambiente: 0, uniforme: true },
  aconchego:  { nome: 'Aconchegante', desc: 'mais grave e encorpada', vel: 0.92, tom: 0.94, expr: 0.62, ritmo: 0.8, pausas: 1.1, corpo: 5.5, clareza: 0, ambiente: 0.1, uniforme: true },
};
const CTL = ['vel', 'tom', 'expr', 'ritmo', 'pausas', 'corpo', 'clareza', 'ambiente'];
const OPC = ['pularReferencias', 'avisarTabelas', 'lerLegendas', 'citacoes', 'links', 'pronuncias'];
const PAUSA = { frase: 0.35, paragrafo: 0.75, titulo: 1.0, item: 0.5, aviso: 0.75, citacao: 0.75, virgula: 0.12 };
const AMOSTRA = 'Olá! Esta é a Escuta GPECSS. O Serviço Social brasileiro, segundo Iamamoto, 2014, atua nas expressões da questão social. Ajuste a voz como preferir e gere o áudio do seu texto.';

const est = {
  bruto: '', nome: 'texto', adaptado: null, frases: [], pedacos: null, chaveVoz: '',
  audio: null, inicios: [], gerando: false, presetAtual: 'padrao', pronta: false, idJob: 0,
};

/* ---------- preferências ---------- */
function guardar() {
  try { localStorage.setItem('escuta-gpecss', JSON.stringify(lerAjustes())); } catch (e) { /* sem armazenamento */ }
}
function lerAjustes() {
  const a = { preset: est.presetAtual };
  for (const k of CTL) a[k] = Number($(k).value);
  a.uniforme = $('uniforme').checked;
  for (const k of OPC) a[k] = $(k).type === 'checkbox' ? $(k).checked : $(k).value;
  return a;
}
function aplicarAjustes(a) {
  for (const k of CTL) if (a[k] != null) $(k).value = a[k];
  if (a.uniforme != null) $('uniforme').checked = a.uniforme;
  for (const k of OPC) if (a[k] != null) { if ($(k).type === 'checkbox') $(k).checked = a[k]; else $(k).value = a[k]; }
  mostrarValores();
}
function mostrarValores() {
  const f = {
    vel: (v) => v.toFixed(2).replace('.', ',') + '×', tom: (v) => (v === 1 ? 'natural' : v < 1 ? 'mais grave' : 'mais agudo'),
    expr: (v) => Math.round(v * 100) + '%', ritmo: (v) => Math.round(v * 100) + '%', pausas: (v) => v.toFixed(1).replace('.', ',') + '×',
    corpo: (v) => '+' + v + ' dB', clareza: (v) => (v > 0 ? '+' : '') + v + ' dB', ambiente: (v) => (v ? Math.round(v * 400) + '%' : 'seco'),
  };
  for (const k of CTL) $(k + 'O').textContent = f[k](Number($(k).value));
}

function montarPresets() {
  const box = $('presets');
  for (const [id, p] of Object.entries(PRESETS)) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'preset'; b.setAttribute('role', 'radio'); b.dataset.id = id;
    b.innerHTML = `${p.nome}<small>${p.desc}</small>`;
    b.addEventListener('click', () => escolherPreset(id));
    box.appendChild(b);
  }
}
function escolherPreset(id) {
  est.presetAtual = id;
  aplicarAjustes(PRESETS[id]);
  document.querySelectorAll('.preset').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.id === id)));
  guardar();
  marcarMudanca();
}

/* ---------- status ---------- */
function status(t, frac) {
  $('status').textContent = t;
  if (frac != null) $('barraIn').style.width = Math.round(Math.max(0, Math.min(1, frac)) * 100) + '%';
}

/* ---------- motor de voz (várias "linhas de produção" em paralelo) ---------- */
const NUCLEOS = navigator.hardwareConcurrency || 4;
const N_WORKERS = Math.max(1, Math.min(4, Math.floor(NUCLEOS / 3), (navigator.deviceMemory || 8) >= 4 ? 4 : 1));
const workers = [];
const ouvintes = new Set();
let iniciado = false;
let vozPronta = null;
function criarWorker() {
  const w = new Worker('js/voz-worker.js');
  w.onmessage = (ev) => {
    const m = ev.data;
    if (m.tipo === 'download' && m.rotulo === 'voz') {
      status(`Baixando a voz (só na primeira vez): ${(m.recebido / 1e6).toFixed(0)} de ${(m.total / 1e6).toFixed(0)} MB`, m.total ? m.recebido / m.total : 0);
    } else if (m.tipo === 'estado') status(m.texto);
    for (const f of ouvintes) f(m, w);
  };
  return w;
}
function esperarPronto(w) {
  return new Promise((ok, erro) => {
    const f = (m, de) => {
      if (de !== w) return;
      if (m.tipo === 'pronto') { ouvintes.delete(f); ok(); }
      else if (m.tipo === 'erro' && m.id == null) { ouvintes.delete(f); erro(new Error(m.texto)); }
    };
    ouvintes.add(f);
    w.postMessage({ tipo: 'iniciar' });
  });
}
function iniciarVoz() {
  if (!iniciado) {
    iniciado = true;
    // o primeiro baixa e guarda a voz; os demais já a encontram guardada
    const w0 = criarWorker(); workers.push(w0);
    vozPronta = esperarPronto(w0).then(async () => {
      est.pronta = true;
      const extras = [];
      for (let k = 1; k < N_WORKERS; k++) { const w = criarWorker(); workers.push(w); extras.push(esperarPronto(w).catch(() => null)); }
      await Promise.all(extras);
    });
  }
  return vozPronta;
}
(async () => {
  try {
    const c = await caches.open('escuta-gpecss-voz-v1');
    const tem = await c.match('https://huggingface.co/diffusionstudio/piper-voices/resolve/main/pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx');
    if (tem) iniciarVoz();
  } catch (e) { /* sem cache */ }
})();

function escalas(a) {
  // tom: gera mais lento e acelera na lapidação, para mudar a altura sem mudar a duração
  return { noise: a.expr, length: (1 / a.vel) * a.tom, noiseW: a.ritmo };
}

function sintetizar(frases, a, aoProgredir) {
  workers.forEach((w) => w.postMessage({ tipo: 'cancelar', id: est.idJob }));
  const id = ++est.idJob;
  const textos = frases.map((f) => f.texto);
  const ativos = workers.slice(0, Math.max(1, Math.min(workers.length, Math.ceil(textos.length / 4))));
  return new Promise((ok, erro) => {
    const pedacos = new Array(textos.length);
    let feitos = 0, fins = 0;
    // fatias intercaladas: cada linha de produção pega blocos de 6 frases em sequência
    const BL = 6;
    const fatias = ativos.map(() => []);
    for (let b = 0, k = 0; b < textos.length; b += BL, k++) fatias[k % ativos.length].push(b);
    const f = (m) => {
      if (m.id !== id) return;
      if (m.tipo === 'audio') {
        pedacos[m.i] = paraInt16(aparar(m.pcm)); feitos++;
        aoProgredir && aoProgredir(feitos, textos.length, m.i);
      } else if (m.tipo === 'fim') { if (++fins === ativos.length) { ouvintes.delete(f); ok(pedacos); } }
      else if (m.tipo === 'erro') { ouvintes.delete(f); erro(new Error(m.texto)); }
    };
    ouvintes.add(f);
    ativos.forEach((w, k) => {
      const indices = [];
      for (const b of fatias[k]) for (let i = b; i < Math.min(b + BL, textos.length); i++) indices.push(i);
      w.postMessage({ tipo: 'sintetizar', id, indices, frases: indices.map((i) => textos[i]), escalas: escalas(a) });
    });
  });
}

function pausasDe(frases, a) {
  return frases.map((f, i) => {
    let s;
    if (f.ultima) s = PAUSA[f.tipo] || PAUSA.paragrafo;
    else s = /,$/.test(f.texto) ? PAUSA.virgula : PAUSA.frase;
    if (frases[i + 1] && frases[i + 1].tipo === 'titulo' && f.ultima) s = Math.max(s, PAUSA.titulo);
    return s * a.pausas;
  });
}

/* Lapida em trechos de ~3 minutos (economiza memória em textos longos)
   e já vai convertendo para MP3 (ou WAV, na prévia). */
async function produzir(pedacos, frases, a, formato, aoProgredir) {
  const pausas = pausasDe(frases, a);
  const aj = { tom: a.tom, corpo: a.corpo, clareza: a.clareza, ambiente: a.ambiente, uniforme: a.uniforme };
  const enc = formato === 'mp3' ? criarMp3() : null;
  const partesWav = [];
  const inicios = [];
  let pos = 0;
  const LIMITE = 180 * TAXA;
  for (let i = 0; i < pedacos.length;) {
    let j = i, tot = 0;
    while (j < pedacos.length && (j === i || tot < LIMITE)) { tot += pedacos[j].length + pausas[j] * TAXA; j++; }
    const { pcm, inicios: ini } = montar(pedacos.slice(i, j), pausas.slice(i, j));
    for (const t of ini) inicios.push(pos / TAXA + t / a.tom);
    const out = await lapidar(pcm, aj);
    pos += out.length;
    const i16 = paraInt16(out);
    if (enc) await enc.adicionar(i16); else partesWav.push(i16);
    aoProgredir && aoProgredir(j / pedacos.length);
    i = j;
  }
  const blob = enc ? enc.fechar() : wav(partesWav);
  return { blob, inicios, duracao: pos / TAXA };
}

/* ---------- texto ---------- */
function prepararTexto() {
  const a = lerAjustes();
  est.adaptado = adaptarTexto(est.bruto, a);
  est.frases = [];
  est.adaptado.blocos.forEach((b, bi) => b.frases.forEach((f, fi) => est.frases.push({ texto: f, tipo: b.tipo, bloco: bi, ultima: fi === b.frases.length - 1 })));
  desenharLeitura();
}

function desenharLeitura() {
  const box = $('leitura');
  box.innerHTML = '';
  let k = 0;
  for (const b of est.adaptado.blocos) {
    const p = document.createElement('p');
    p.className = b.tipo;
    for (const f of b.frases) {
      const s = document.createElement('span');
      s.className = 'frase pendente'; s.textContent = f + ' '; s.dataset.i = k++;
      s.addEventListener('click', () => irPara(Number(s.dataset.i)));
      p.appendChild(s);
    }
    box.appendChild(p);
  }
}

function irPara(i) {
  if (!est.inicios.length) return;
  const pl = $('player');
  pl.currentTime = est.inicios[i] + 0.01;
  pl.play();
}

function textoAdaptadoPlano() {
  return est.adaptado.blocos.map((b) => (b.tipo === 'item' ? '• ' : '') + b.frases.join(' ')).join('\n\n');
}

/* ---------- fluxo principal ---------- */
async function gerar(somenteLapidar = false) {
  if (est.gerando || !est.bruto) return;
  est.gerando = true; atualizarBotoes();
  $('reaplicar').hidden = true;
  const a = lerAjustes();
  try {
    if (!somenteLapidar) prepararTexto();
    if (!est.frases.length) { status('Não encontrei texto para ler neste arquivo.'); return; }
    const chave = JSON.stringify([escalas(a), est.frases.map((f) => f.texto)]);
    status('Preparando a voz…', 0.02);
    await iniciarVoz();
    let pedacos = est.pedacos;
    if (!pedacos || chave !== est.chaveVoz) {
      const t0 = performance.now();
      const spans = $('leitura').querySelectorAll('.frase');
      pedacos = await sintetizar(est.frases, a, (feitos, total, i) => {
        const dec = (performance.now() - t0) / 1000;
        const resta = feitos > 4 ? Math.round((dec / feitos) * (total - feitos)) : null;
        status(`Gerando a fala: ${feitos} de ${total} frases` + (resta != null ? ` · faltam cerca de ${tempo(resta)}` : ''), 0.05 + 0.8 * feitos / total);
        if (spans[i]) spans[i].classList.replace('pendente', 'feita');
      });
      est.pedacos = pedacos; est.chaveVoz = chave;
    }
    status('Lapidando o áudio e criando o MP3…', 0.86);
    const { blob: arquivo, inicios, duracao } = await produzir(pedacos, est.frases, a, 'mp3', (f) => status('Lapidando o áudio e criando o MP3…', 0.86 + f * 0.14));
    est.inicios = inicios;
    if (est.audio) URL.revokeObjectURL(est.audio);
    est.audio = URL.createObjectURL(arquivo);
    $('player').src = est.audio;
    $('baixarMp3').href = est.audio; $('baixarMp3').download = est.nome + '.mp3';
    const txt = URL.createObjectURL(new Blob([textoAdaptadoPlano()], { type: 'text/plain;charset=utf-8' }));
    $('baixarTxt').href = txt; $('baixarTxt').download = est.nome + ' (adaptado).txt';
    $('resultado').hidden = false;
    $('leitura').querySelectorAll('.frase').forEach((s) => s.classList.replace('pendente', 'feita'));
    const dur = duracao;
    const r = est.adaptado.relatorio;
    const extras = [];
    if (r.tabelas) extras.push(`${r.tabelas} tabela(s) avisada(s)`);
    if (r.referenciasPuladas) extras.push('referências puladas');
    if (r.linhasRemovidas) extras.push(`${r.linhasRemovidas} linha(s) de ruído removida(s)`);
    status(`Pronto! Áudio de ${tempo(Math.round(dur))} (${(arquivo.size / 1e6).toFixed(1).replace('.', ',')} MB).` + (extras.length ? ' ' + extras.join(', ') + '.' : ''), 1);
  } catch (e) {
    console.error(e);
    status('Algo deu errado: ' + (e.message || e));
  } finally {
    est.gerando = false; atualizarBotoes();
  }
}

function tempo(s) {
  if (s < 60) return s + ' s';
  const m = Math.floor(s / 60), r = s % 60;
  if (m < 60) return m + ' min' + (r ? ' ' + r + ' s' : '');
  return Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
}

async function previa() {
  if (est.gerando) return;
  est.gerando = true; atualizarBotoes();
  const a = lerAjustes();
  try {
    let frases;
    if (est.bruto) {
      if (!est.frases.length) prepararTexto();
      frases = est.frases.slice(0, 4);
    } else {
      const ad = adaptarTexto(AMOSTRA, a);
      frases = [];
      ad.blocos.forEach((b) => b.frases.forEach((f, fi) => frases.push({ texto: f, tipo: b.tipo, ultima: fi === b.frases.length - 1 })));
    }
    status('Preparando a prévia…', 0.05);
    await iniciarVoz();
    const ped = await sintetizar(frases, a, (f, t) => status(`Preparando a prévia… ${f} de ${t}`, f / t));
    const { blob } = await produzir(ped, frases, a, 'wav');
    const url = URL.createObjectURL(blob);
    const au = new Audio(url);
    au.play();
    status('Tocando a prévia. Se gostar, gere o áudio completo.', 1);
  } catch (e) {
    status('Algo deu errado na prévia: ' + (e.message || e));
  } finally {
    est.gerando = false; atualizarBotoes();
  }
}

function atualizarBotoes() {
  $('gerar').disabled = est.gerando || !est.bruto;
  $('previa').disabled = est.gerando;
  $('gerar').textContent = est.pedacos ? 'Gerar de novo' : 'Gerar áudio';
}

function marcarMudanca() {
  if (est.audio && !est.gerando) $('reaplicar').hidden = false;
}

async function receberTexto(texto, nome) {
  est.bruto = texto;
  est.nome = (nome || 'texto').replace(/\.[^.]+$/, '');
  est.pedacos = null; est.chaveVoz = ''; est.inicios = [];
  $('resultado').hidden = true;
  $('arquivoNome').textContent = nome ? `Arquivo: ${nome}` : 'Texto colado.';
  atualizarBotoes();
  $('secResultado').scrollIntoView({ behavior: 'smooth', block: 'start' });
  await gerar();
}

async function receberArquivo(arq) {
  if (!arq) return;
  try {
    status('Lendo o arquivo…', 0.01);
    iniciarVoz();
    const texto = await extrair(arq, (f) => status('Lendo o arquivo…', f * 0.05));
    if (!texto.trim()) throw new Error('Não encontrei texto neste arquivo.');
    await receberTexto(texto, arq.name);
  } catch (e) {
    status(e.message || String(e), 0);
  }
}

/* ---------- eventos ---------- */
function ligar() {
  montarPresets();
  $('pronuncias').value = PRONUNCIAS_PADRAO;
  let salvo = null;
  try { salvo = JSON.parse(localStorage.getItem('escuta-gpecss') || 'null'); } catch (e) { salvo = null; }
  const base = { ...PRESETS.padrao, pularReferencias: true, avisarTabelas: true, lerLegendas: true, citacoes: 'curta', links: 'dominio' };
  aplicarAjustes({ ...base, ...(salvo || {}) });
  est.presetAtual = salvo && salvo.preset || 'padrao';
  document.querySelectorAll('.preset').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.id === est.presetAtual)));

  for (const k of CTL) $(k).addEventListener('input', () => {
    mostrarValores(); est.presetAtual = 'personalizado';
    document.querySelectorAll('.preset').forEach((b) => b.setAttribute('aria-checked', 'false'));
    guardar(); marcarMudanca();
  });
  for (const k of [...OPC, 'uniforme']) $(k).addEventListener('change', () => { guardar(); est.pedacos = OPC.includes(k) ? null : est.pedacos; marcarMudanca(); });
  $('restaurarPron').addEventListener('click', () => { $('pronuncias').value = PRONUNCIAS_PADRAO; guardar(); marcarMudanca(); });

  const zona = $('soltar');
  $('arquivo').addEventListener('change', (e) => receberArquivo(e.target.files[0]));
  zona.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('arquivo').click(); } });
  ['dragenter', 'dragover'].forEach((t) => document.addEventListener(t, (e) => { e.preventDefault(); zona.classList.add('arrastando'); }));
  ['dragleave', 'drop'].forEach((t) => document.addEventListener(t, (e) => { e.preventDefault(); if (t === 'drop' || e.target === zona) zona.classList.remove('arrastando'); }));
  document.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) receberArquivo(f); });

  $('usarColado').addEventListener('click', () => { const t = $('textoColado').value; if (t.trim()) receberTexto(t, ''); });
  $('gerar').addEventListener('click', () => gerar());
  $('reaplicar').addEventListener('click', () => gerar(!!est.pedacos && est.frases.length > 0));
  $('previa').addEventListener('click', previa);

  const pl = $('player');
  let atual = -1;
  pl.addEventListener('timeupdate', () => {
    const t = pl.currentTime;
    let i = est.inicios.length - 1;
    while (i > 0 && est.inicios[i] > t) i--;
    if (i !== atual) {
      const spans = $('leitura').querySelectorAll('.frase');
      if (spans[atual]) spans[atual].classList.remove('atual');
      if (spans[i]) {
        spans[i].classList.add('atual');
        const box = $('leitura');
        const top = spans[i].offsetTop - box.offsetTop;
        if (top < box.scrollTop || top > box.scrollTop + box.clientHeight - 40) box.scrollTo({ top: top - 60, behavior: 'smooth' });
      }
      atual = i;
    }
  });
  atualizarBotoes();
}
ligar();
