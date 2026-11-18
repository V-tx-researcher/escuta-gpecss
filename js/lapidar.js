/* Escuta GPECSS — montagem e "lapidação" do áudio, e conversão para MP3/WAV. */

const TAXA = 22050;

/* Devolve a vez ao navegador sem o atraso que os temporizadores sofrem em abas de fundo. */
export function ceder() {
  return new Promise((ok) => { const c = new MessageChannel(); c.port1.onmessage = () => ok(); c.port2.postMessage(0); });
}

/* Corta silêncio no começo e no fim de cada frase gerada. */
export function aparar(pcm, limiar = 0.012, margem = 0.03) {
  let ini = 0, fim = pcm.length - 1;
  while (ini < pcm.length && Math.abs(pcm[ini]) < limiar) ini++;
  while (fim > ini && Math.abs(pcm[fim]) < limiar) fim--;
  const m = Math.round(margem * TAXA);
  return pcm.subarray(Math.max(0, ini - m), Math.min(pcm.length, fim + m));
}

/* Junta as frases com pausas. Devolve o áudio e o início (em s) de cada frase. */
export function montar(pedacos, pausasSeg) {
  let total = 0;
  for (let i = 0; i < pedacos.length; i++) total += pedacos[i].length + Math.round((pausasSeg[i] || 0) * TAXA);
  const saida = new Float32Array(total);
  const inicios = [];
  let p = 0;
  for (let i = 0; i < pedacos.length; i++) {
    inicios.push(p / TAXA);
    const ped = pedacos[i];
    if (ped instanceof Int16Array) { for (let k = 0; k < ped.length; k++) saida[p + k] = ped[k] / 32768; }
    else saida.set(ped, p);
    p += pedacos[i].length + Math.round((pausasSeg[i] || 0) * TAXA);
  }
  return { pcm: saida, inicios };
}

function impulsoSala(ctx, dur = 0.7) {
  const n = Math.round(dur * ctx.sampleRate);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let semente = 12345;
  const rnd = () => ((semente = (semente * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < n; i++) d[i] = rnd() * Math.pow(1 - i / n, 3.2) * (i < 220 ? i / 220 : 1);
  return buf;
}

/* Cadeia de estúdio: filtro de graves, corpo, clareza, suavização de agudos,
   compressão, ambiente, volume uniforme e mudança de tom. */
export async function lapidar(pcm, aj) {
  const tom = aj.tom || 1;
  const comprimento = Math.ceil(pcm.length / tom);
  const ctx = new OfflineAudioContext(1, comprimento, TAXA);
  const buf = ctx.createBuffer(1, pcm.length, TAXA);
  buf.copyToChannel(pcm, 0);
  const fonte = ctx.createBufferSource();
  fonte.buffer = buf;
  fonte.playbackRate.value = tom;

  const passaAlta = ctx.createBiquadFilter(); passaAlta.type = 'highpass'; passaAlta.frequency.value = 75;
  const corpo = ctx.createBiquadFilter(); corpo.type = 'lowshelf'; corpo.frequency.value = 220; corpo.gain.value = aj.corpo;
  const lama = ctx.createBiquadFilter(); lama.type = 'peaking'; lama.frequency.value = 450; lama.Q.value = 1; lama.gain.value = -1.5;
  const clareza = ctx.createBiquadFilter(); clareza.type = 'peaking'; clareza.frequency.value = 3200; clareza.Q.value = 0.9; clareza.gain.value = aj.clareza;
  const suave = ctx.createBiquadFilter(); suave.type = 'highshelf'; suave.frequency.value = 7500; suave.gain.value = -3;

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = aj.uniforme ? -26 : -12;
  comp.ratio.value = aj.uniforme ? 3.5 : 1.5;
  comp.knee.value = 8; comp.attack.value = 0.006; comp.release.value = 0.18;

  fonte.connect(passaAlta).connect(corpo).connect(lama).connect(clareza).connect(suave).connect(comp);
  const seco = ctx.createGain(); seco.gain.value = 1;
  comp.connect(seco).connect(ctx.destination);
  if (aj.ambiente > 0) {
    const sala = ctx.createConvolver(); sala.normalize = true; sala.buffer = impulsoSala(ctx);
    const molhado = ctx.createGain(); molhado.gain.value = aj.ambiente;
    comp.connect(sala).connect(molhado).connect(ctx.destination);
  }
  fonte.start();
  const render = await ctx.startRendering();
  const out = render.getChannelData(0);

  // volume uniforme: leva o RMS da fala a um alvo e limita os picos
  let soma = 0, n = 0;
  for (let i = 0; i < out.length; i++) { const v = out[i]; if (Math.abs(v) > 0.02) { soma += v * v; n++; } }
  const rms = n ? Math.sqrt(soma / n) : 0.1;
  let ganho = 0.16 / (rms || 0.1);
  let pico = 0;
  for (let i = 0; i < out.length; i++) pico = Math.max(pico, Math.abs(out[i]));
  if (pico * ganho > 0.89) ganho = Math.min(ganho, 0.89 / pico * 1.6);
  for (let i = 0; i < out.length; i++) {
    let v = out[i] * ganho;
    if (v > 0.89) v = 0.89 + Math.tanh((v - 0.89) * 4) * 0.1;
    else if (v < -0.89) v = -0.89 + Math.tanh((v + 0.89) * 4) * 0.1;
    out[i] = v;
  }
  const fade = Math.round(0.01 * TAXA);
  for (let i = 0; i < fade && i < out.length; i++) { out[i] *= i / fade; out[out.length - 1 - i] *= i / fade; }
  return out;
}

export function paraInt16(pcm) {
  const r = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) { const v = Math.max(-1, Math.min(1, pcm[i])); r[i] = v < 0 ? v * 0x8000 : v * 0x7fff; }
  return r;
}

export function wav(partes) {
  let n = 0; for (const x of partes) n += x.length;
  const dados = new Int16Array(n); let o = 0; for (const x of partes) { dados.set(x, o); o += x.length; }
  const buf = new ArrayBuffer(44 + dados.length * 2);
  const v = new DataView(buf);
  const s = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
  s(0, 'RIFF'); v.setUint32(4, 36 + dados.length * 2, true); s(8, 'WAVE'); s(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, TAXA, true); v.setUint32(28, TAXA * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  s(36, 'data'); v.setUint32(40, dados.length * 2, true);
  new Int16Array(buf, 44).set(dados);
  return new Blob([buf], { type: 'audio/wav' });
}

export function criarMp3() {
  const enc = new lamejs.Mp3Encoder(1, TAXA, 64);
  const partes = [];
  return {
    async adicionar(dados) {
      const BLOCO = 1152 * 40;
      for (let i = 0; i < dados.length; i += BLOCO) {
        const r = enc.encodeBuffer(dados.subarray(i, i + BLOCO));
        if (r.length) partes.push(new Uint8Array(r));
        if ((i / BLOCO) % 25 === 0) await ceder();
      }
    },
    fechar() {
      const f = enc.flush();
      if (f.length) partes.push(new Uint8Array(f));
      return new Blob(partes, { type: 'audio/mpeg' });
    },
  };
}

export { TAXA };
