/* Escuta GPECSS — adaptação de texto para escuta.
   Recebe texto bruto (com marcações simples: "# " para título, "- " para item,
   "[[TABELA]]" para tabela, "[[IMAGEM: legenda]]") e devolve blocos com frases
   prontas para a voz, sem símbolos que quebrem a imersão. */

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const ORD_M = ['', 'primeiro', 'segundo', 'terceiro', 'quarto', 'quinto', 'sexto', 'sétimo', 'oitavo', 'nono'];
const ORD_D = ['', 'décimo', 'vigésimo', 'trigésimo', 'quadragésimo', 'quinquagésimo', 'sexagésimo', 'septuagésimo', 'octogésimo', 'nonagésimo'];

function ordinal(n, fem) {
  if (n < 1 || n > 99) return null;
  const d = Math.floor(n / 10), u = n % 10;
  let s = [ORD_D[d], ORD_M[u]].filter(Boolean).join(' ');
  if (fem) s = s.split(' ').map((p) => p.replace(/o$/, 'a')).join(' ');
  return s;
}

function romano(r) {
  const v = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let t = 0;
  for (let i = 0; i < r.length; i++) {
    const a = v[r[i]], b = v[r[i + 1]] || 0;
    t += a < b ? -a : a;
  }
  return t;
}

/* Pronúncias padrão (podem ser ampliadas pela pessoa na tela). */
export const PRONUNCIAS_PADRAO = `GPECSS = gê pê é cê ésse ésse
CFESS = cefess
CRESS = créss
ABEPSS = abepss
ENESSO = enésso
SUS = sus
SUAS = suas
CRAS = cras
CREAS = créas
LOAS = loas
ECA = éca
INSS = i ene ésse ésse
IBGE = i bê gê é
ONU = onu
OMS = ó ême ésse
ABNT = a bê ene tê
NBR = ene bê érre
PcD = pessoa com deficiência
PcDs = pessoas com deficiência
LGBTQIAPN+ = éle gê bê tê quê i a pê ene mais
LGBTQIA+ = éle gê bê tê quê i a mais
LGBT = éle gê bê tê
UNILAGO = unilago
UNESP = unésp
USP = usp
CAPES = cápes
CNPq = cê ene pê quê
FAPESP = fapésp
TCC = tê cê cê
TCLE = tê cê éle é
CEP = cép
COFI = cófi
DOI = dói
ISBN = i ésse bê ene
ISSN = i ésse ésse ene
PDF = pê dê éfe
IA = i a`;

export function lerPronuncias(texto) {
  const lista = [];
  for (const linha of String(texto || '').split(/\n/)) {
    const m = linha.match(/^\s*(.+?)\s*=\s*(.+?)\s*$/);
    if (m) lista.push([m[1], m[2]]);
  }
  lista.sort((a, b) => b[0].length - a[0].length);
  return lista;
}

function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function tituloCaso(p) {
  return p.toLowerCase().replace(/(^|[\s\-'])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
}

function dominio(url) {
  let d = url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#:]/)[0];
  d = d.replace(/\.$/, '');
  return d.split('.').join(' ponto ');
}

function numeroDecimal(int, dec) {
  return int.replace(/\./g, '') + (dec ? ' vírgula ' + dec : '');
}

/* ---------- transformações dentro de uma linha ---------- */
export function adaptarLinha(t, op) {
  // Markdown inline
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, (m, alt) => (alt ? ' imagem: ' + alt + '. ' : ' '));
  t = t.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1');
  t = t.replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/(^|\s)[*_](\S[^*_]*?)[*_](?=\s|[.,;:!?]|$)/g, '$1$2');
  t = t.replace(/`([^`]*)`/g, '$1').replace(/~~(.+?)~~/g, '$1');

  // Endereços
  t = t.replace(/\b(doi:\s*|https?:\/\/(dx\.)?doi\.org\/)\S+/gi, ' ');
  t = t.replace(/(Dispon[ií]vel em|Acesso em)\s*:?\s*/gi, (m, a) => (op.links === 'omitir' ? '' : m));
  t = t.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, ' endereço de e-mail ');
  t = t.replace(/\b(https?:\/\/|www\.)[^\s<>"')\]]+/gi, (u) => {
    const limpa = u.replace(/[.,;:]+$/, '');
    return op.links === 'omitir' ? ' ' : ' link para ' + dominio(limpa) + ' ';
  });

  // Emojis e pictogramas
  t = t.replace(/[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}️‍⃣]/gu, ' ');

  // Notas de rodapé
  t = t.replace(/[¹²³⁰-⁹]+/g, '');
  t = t.replace(/\[(\d+([,–-]\s*\d+)*)\]/g, '');
  t = t.replace(/(\p{Ll}{3,}[.,;:!?”"])(\d{1,3})(?=\s|$)/gu, '$1');

  // Pronúncias personalizadas (antes de mexer em maiúsculas)
  for (const [de, para] of op.pronuncias) {
    t = t.replace(new RegExp('(^|[^\\p{L}\\d])' + escRe(de) + '(?=$|[^\\p{L}\\d])', 'gu'), '$1' + para);
  }

  // Citações (AUTOR; AUTOR, 2020, p. 45)
  t = t.replace(/\(([^()]*\b(1[5-9]|20)\d{2}[a-z]?\b[^()]*)\)/g, (m, dentro) => {
    if (op.citacoes === 'omitir') return ' ';
    let d = dentro.replace(/\b(\p{Lu}[\p{Lu}'-]{1,})\b/gu, (w) => (w.length > 1 ? tituloCaso(w) : w));
    d = d.replace(/\s*;\s*/g, ' e ');
    if (op.citacoes === 'curta') d = d.replace(/,\s*(p|pp|f)\.\s*[\d\s–-]+/gi, '');
    return '(' + d + ')';
  });
  // AUTOR (2020)
  t = t.replace(/\b(\p{Lu}{3,}(?:\s+(?:e|&)\s+\p{Lu}{3,})?)(?=\s*\(\s*(1[5-9]|20)\d{2})/gu, (w) => tituloCaso(w));

  // Abreviaturas comuns
  const abrev = [
    [/\bet\s+al\.?/gi, 'e colaboradores'], [/\bapud\b/gi, 'citado por'], [/\bop\.\s*cit\./gi, 'obra citada'],
    [/\bibid\.?/gi, 'mesma obra'], [/\bidem\b\.?/gi, 'mesmo autor'], [/\bpp\.\s*(?=\d)/gi, 'páginas '],
    [/\bp\.\s*(?=\d)/gi, 'página '], [/\bfl?s?\.\s*(?=\d)/gi, 'folha '], [/\bv\.\s*(?=\d)/gi, 'volume '],
    [/\bvol\.\s*(?=\d)/gi, 'volume '], [/\bn\.\s*(?=\d)/gi, 'número '], [/\bed\.\s*(?=\d)/gi, 'edição '],
    [/(\d)\s*\.?\s*ed\./gi, '$1 edição'], [/\bcap\.\s*/gi, 'capítulo '], [/\barts\.\s*/gi, 'artigos '],
    [/\bart\.\s*/gi, 'artigo '], [/\binc\.\s*/gi, 'inciso '], [/§§\s*/g, 'parágrafos '], [/§\s*/g, 'parágrafo '],
    [/\bn\.?\s*[ºo°]\s*(?=\d)/gi, 'número '], [/\bN[ºo°]\s*(?=\d)/g, 'número '],
    [/\bSra\.\s*/g, 'Senhora '], [/\bSr\.\s*/g, 'Senhor '], [/\bDra\.\s*/g, 'Doutora '], [/\bDr\.\s*/g, 'Doutor '],
    [/\bProfa\.\s*/g, 'Professora '], [/\bProf\.\s*/g, 'Professor '], [/\betc\.?/gi, 'etcétera'],
    [/\b[Ee]x\.\s*:?/g, 'por exemplo'], [/\be\.\s?g\.,?/gi, 'por exemplo'], [/\bi\.\s?e\.,?/gi, 'isto é'],
    [/\b[Oo]bs\.\s*:?/g, 'observação:'], [/\bvs\.?(?=\s)/gi, 'versus'], [/\baprox\./gi, 'aproximadamente'],
    [/\bséc\.\s*/gi, 'século '], [/\bs\.\s?d\./gi, 'sem data'], [/\bs\.\s?l\./gi, 'sem local'], [/\bs\/n\b/gi, 'sem número'],
    [/\bmin\.(?=\s)/gi, 'minutos'], [/\bOrg\.|\borg\.\b/g, 'organizador'], [/\bcf\./gi, 'conferir'],
  ];
  for (const [re, s] of abrev) t = t.replace(re, s);

  // Romanos depois de palavras de contexto
  t = t.replace(/\b(século|capítulo|inciso|parte|volume|título|livro|seção|tomo|fase|nível)\s+([IVXLCDM]{1,7})\b/gi,
    (m, p, r) => p + ' ' + romano(r.toUpperCase()));

  // Dinheiro
  t = t.replace(/(R\$|US\$|€)\s*([\d.]+)(?:,(\d{2}))?/g, (m, moeda, int, cent) => {
    const nome = moeda === 'R$' ? 'reais' : moeda === 'US$' ? 'dólares' : 'euros';
    return int.replace(/\./g, '') + ' ' + nome + (cent && cent !== '00' ? ' e ' + Number(cent) + ' centavos' : '');
  });

  // Datas e horas
  t = t.replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/g, (m, d, mes, a) => {
    const mi = Number(mes) - 1;
    if (mi < 0 || mi > 11 || Number(d) < 1 || Number(d) > 31) return m;
    const ano = a.length === 2 ? (Number(a) > 40 ? '19' : '20') + a : a;
    return (Number(d) === 1 ? 'primeiro' : Number(d)) + ' de ' + MESES[mi] + ' de ' + ano;
  });
  t = t.replace(/\b(\d{1,2})\s?[h:](\d{2})(min)?\b/g, (m, h, mi) => (Number(mi) ? `${Number(h)} horas e ${Number(mi)}` : `${Number(h)} horas`));
  t = t.replace(/\b(\d{1,2})h\b/g, '$1 horas');

  // Ordinais
  t = t.replace(/\b(\d{1,2})\s?([ºª°o]|\.º|\.ª)(?!\s*C\b)/g, (m, n, s) => ordinal(Number(n), /ª/.test(s)) || m);

  // Porcentagem, intervalos e números
  t = t.replace(/(\d)\s?%/g, '$1 por cento');
  t = t.replace(/\b(\d{1,3}(?:\.\d{3})+)(?:,(\d+))?\b/g, (m, i, d) => numeroDecimal(i, d));
  t = t.replace(/\b(\d+),(\d+)\b/g, '$1 vírgula $2');
  t = t.replace(/\b(\d+)\s?[–-]\s?(\d+)\b/g, '$1 a $2');
  t = t.replace(/\b(\d+(?:\.\d+)+)\b(?!\s*\d)/g, (m) => (/^\d{1,2}(\.\d{1,2})+$/.test(m) ? m.split('.').join(' ponto ') : m));

  // Símbolos com leitura
  t = t.replace(/(\d)\s*°\s*C\b/g, '$1 graus Celsius').replace(/(\d)\s*°/g, '$1 graus');
  t = t.replace(/(\d)\s*[x×]\s*(\d)/g, '$1 por $2');
  t = t.replace(/\s±\s?/g, ' mais ou menos ').replace(/\s?≥\s?/g, ' maior ou igual a ').replace(/\s?≤\s?/g, ' menor ou igual a ');
  t = t.replace(/(\d)\s*>\s*(\d)/g, '$1 maior que $2').replace(/(\d)\s*<\s*(\d)/g, '$1 menor que $2');
  t = t.replace(/\s=\s/g, ' igual a ').replace(/(\s|\d)\+(\s|\d)/g, '$1 mais $2');
  t = t.replace(/\s&\s/g, ' e ');
  t = t.replace(/\be\/ou\b/gi, 'e ou').replace(/\bo\(a\)/gi, 'o ou a').replace(/\b(\p{L}+)\(a\)s?\b/gu, '$1');
  t = t.replace(/(\p{L}{2,})\/(\p{L}{2,})/gu, '$1 ou $2');
  t = t.replace(/@(\w)/g, '$1').replace(/#(\p{L})/gu, '$1');

  // Pontuação que vira pausa
  t = t.replace(/\s*[(\[{]\s*/g, ', ').replace(/\s*[)\]}]\s*(?=[.,;:!?])/g, '').replace(/\s*[)\]}]\s*/g, ', ');
  t = t.replace(/\s+[–—―]\s+|[–—―]{1,2}/g, ', ');
  t = t.replace(/\s-\s/g, ', ');
  t = t.replace(/…|\.{3,}/g, '.');

  // Símbolos que não devem ser lidos
  t = t.replace(/[“”„‟"«»‹›]/g, '').replace(/[‘’‚‛]/g, "'").replace(/(^|\s)'|'(\s|$)/g, '$1$2');
  t = t.replace(/[*_#|~^<>\\©®™¶†‡※→←↑↓↔⇒⇐⇔►▶◄◀•●○◦▪▫■□◆◇★☆✓✔✗✘✦✧❖➢➤➔✱✲⁂§¤¦¨¯´¸·]/g, ' ');
  t = t.replace(/(^|\s)[-=_.]{2,}(?=\s|$)/g, ' ');

  // Limpeza final
  t = t.replace(/\s+([.,;:!?])/g, '$1').replace(/([,;:])(?:\s*[,;:])+/g, '$1');
  t = t.replace(/[!?]{2,}/g, (m) => (m.includes('?') ? '?' : '!')).replace(/\.{2,}/g, '.');
  t = t.replace(/,\s*\./g, '.').replace(/^[\s,;:.]+/, '').replace(/\s{2,}/g, ' ').trim();
  return t;
}

/* ---------- estrutura do documento ---------- */
const RE_ITEM = /^\s*(?:[-*+•●○◦▪▫■□◆◇➢➤►▶✓✔–—]|\(?\d{1,2}[.)]|\(?[a-z][)])\s+/i;
const RE_PAGINA = /^\s*(?:p[áa]g(?:ina)?\.?\s*)?\d{1,4}(?:\s*(?:de|\/)\s*\d{1,4})?\s*$/i;
const RE_REFS = /^\s*(?:\d+(?:\.\d+)*\.?\s*)?(refer[êe]ncias(\s+bibliogr[áa]ficas)?|bibliografia|obras\s+citadas|references)\s*:?\s*$/i;

function ehTitulo(linha) {
  const l = linha.trim();
  if (l.length < 2 || l.length > 110) return false;
  if (/^#{1,6}\s/.test(l)) return true;
  if (/[.,;:!?]$/.test(l) && !/^\d+(\.\d+)*\.\s/.test(l)) return false;
  const letras = l.replace(/[^\p{L}]/gu, '');
  if (letras.length >= 4 && letras === letras.toUpperCase()) return true;
  if (/^\d+(\.\d+)*\.?\s+\p{Lu}/u.test(l) && l.split(/\s+/).length <= 8 && !/\s(o|a|os|as|de|do|da|que|como|e|em|para|com)$/i.test(l)) return true;
  return false;
}

function dividirFrases(t) {
  if (!t) return [];
  const brutas = t.match(/[^.!?]+(?:[.!?]+|$)/g) || [t];
  const frases = [];
  let atual = '';
  for (const b of brutas) {
    const s = b.trim();
    if (!s) continue;
    atual = atual ? atual + ' ' + s : s;
    // junta pedaços curtos demais (ex.: "1." ou "Sr.")
    if (atual.replace(/[^\p{L}]/gu, '').length < 4 && b !== brutas[brutas.length - 1]) continue;
    frases.push(atual);
    atual = '';
  }
  if (atual) frases.push(atual);
  // frases muito longas: quebra em ; ou : ou vírgula
  const final = [];
  for (const f of frases) {
    if (f.length <= 260) { final.push(f); continue; }
    let resto = f;
    while (resto.length > 260) {
      let corte = -1;
      for (const sep of ['; ', ': ', ', ']) {
        const idx = resto.lastIndexOf(sep, 240);
        if (idx > 80) { corte = idx + 1; break; }
      }
      if (corte < 0) { corte = resto.lastIndexOf(' ', 240); if (corte < 40) corte = 240; }
      final.push(resto.slice(0, corte).replace(/[;:,]\s*$/, '').trim() + ',');
      resto = resto.slice(corte).trim();
    }
    if (resto) final.push(resto);
  }
  return final.map((f) => (/[.!?,]$/.test(f) ? f : f + '.').replace(/[.]{2,}$/, '.').replace(/\s[.]\s/g, ' '));
}

export function adaptarTexto(bruto, opcoes = {}) {
  const op = {
    pularReferencias: true, avisarTabelas: true, lerLegendas: true,
    citacoes: 'curta', links: 'dominio', ...opcoes,
  };
  op.pronuncias = lerPronuncias(opcoes.pronuncias ?? PRONUNCIAS_PADRAO);
  const rel = { tabelas: 0, imagens: 0, linhasRemovidas: 0, referenciasPuladas: false };

  let t = String(bruto || '')
    .replace(/\r\n?/g, '\n').replace(/[   ]/g, ' ').replace(/[­​‌⁠﻿]/g, '')
    .replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl').replace(/ﬀ/g, 'ff').replace(/ﬃ/g, 'ffi').replace(/\t/g, ' | ');
  t = t.replace(/(\p{L})-\n\s*(\p{Ll})/gu, '$1$2');

  let linhas = t.split('\n');
  // cabeçalhos/rodapés repetidos (PDF)
  const cont = new Map();
  for (const l of linhas) { const k = l.trim(); if (k && k.length < 90) cont.set(k, (cont.get(k) || 0) + 1); }
  linhas = linhas.filter((l) => {
    const k = l.trim();
    if (RE_PAGINA.test(k) && k) { rel.linhasRemovidas++; return false; }
    if (k && cont.get(k) >= 3 && k.length >= 8 && /\s/.test(k) && !RE_ITEM.test(k) && k.length < 90 && !/^\[\[/.test(k)) { rel.linhasRemovidas++; return false; }
    return true;
  });

  // agrupar em blocos
  const blocos = [];
  let par = [];
  const fecharPar = () => { if (par.length) { blocos.push({ tipo: 'paragrafo', texto: par.join(' ') }); par = []; } };
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i].trim();
    if (!l) { fecharPar(); continue; }
    if (/^\[\[TABELA\]\]$/.test(l) || (l.match(/\|/g) || []).length >= 2) {
      fecharPar();
      if (blocos.length && blocos[blocos.length - 1].tipo === 'tabela') continue;
      blocos.push({ tipo: 'tabela' });
      continue;
    }
    const img = l.match(/^\[\[IMAGEM:?\s*(.*?)\]\]$/);
    if (img) { fecharPar(); blocos.push({ tipo: 'imagem', texto: img[1] }); continue; }
    if (/^#{1,6}\s/.test(l) || (ehTitulo(l) && (!par.length || ehTitulo(par[par.length - 1]) === false))) {
      if (ehTitulo(l)) { fecharPar(); blocos.push({ tipo: 'titulo', texto: l.replace(/^#{1,6}\s*/, '') }); continue; }
    }
    if (/^>\s?/.test(l)) { fecharPar(); blocos.push({ tipo: 'citacao', texto: l.replace(/^>\s?/, '') }); continue; }
    if (RE_ITEM.test(l)) { fecharPar(); blocos.push({ tipo: 'item', texto: l.replace(RE_ITEM, '') }); continue; }
    par.push(l);
  }
  fecharPar();

  // adaptar cada bloco
  const saida = [];
  for (const b of blocos) {
    if (b.tipo === 'titulo' && RE_REFS.test(b.texto) && op.pularReferencias) {
      rel.referenciasPuladas = true;
      saida.push({ tipo: 'aviso', frases: ['As referências bibliográficas não foram lidas nesta versão em áudio.'] });
      break;
    }
    if (b.tipo === 'tabela') {
      rel.tabelas++;
      if (op.avisarTabelas) saida.push({ tipo: 'aviso', frases: ['Aqui o texto apresenta uma tabela, que não foi lida.'] });
      continue;
    }
    if (b.tipo === 'imagem') {
      rel.imagens++;
      const leg = adaptarLinha(b.texto || '', op);
      if (op.lerLegendas && leg) saida.push({ tipo: 'aviso', frases: dividirFrases('Imagem: ' + leg) });
      continue;
    }
    if (!op.lerLegendas && /^(figura|gráfico|grafico|quadro|imagem|tabela|fonte)\b/i.test(b.texto)) continue;
    let texto = b.texto;
    if (b.tipo === 'titulo') {
      const letras = texto.replace(/[^\p{L}]/gu, '');
      if (letras && letras === letras.toUpperCase()) texto = texto.charAt(0) + texto.slice(1).toLowerCase();
      texto = texto.replace(/^(\d+(?:\.\d+)*)\.?\s+/, (m, n) => n.split('.').join(' ponto ') + ', ');
    }
    const adaptado = adaptarLinha(texto, op);
    if (!adaptado || !/\p{L}/u.test(adaptado)) { rel.linhasRemovidas++; continue; }
    saida.push({ tipo: b.tipo, frases: dividirFrases(adaptado) });
  }
  return { blocos: saida, relatorio: rel };
}
