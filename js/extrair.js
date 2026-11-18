/* Escuta GPECSS — leitura de arquivos (PDF, Word, TXT, Markdown, HTML).
   Devolve texto com marcações simples: "# " título, "- " item, [[TABELA]], [[IMAGEM: ...]]. */

const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/';
const MAMMOTH = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.8.0/mammoth.browser.min.js';

function carregarScript(url) {
  return new Promise((ok, erro) => {
    if (document.querySelector(`script[src="${url}"]`)) return ok();
    const s = document.createElement('script');
    s.src = url; s.onload = ok; s.onerror = () => erro(new Error('Não foi possível carregar ' + url));
    document.head.appendChild(s);
  });
}

function decodificar(buf) {
  const utf = new TextDecoder('utf-8').decode(buf);
  if ((utf.match(/�/g) || []).length > 3) return new TextDecoder('windows-1252').decode(buf);
  return utf;
}

/* Percorre HTML e produz texto marcado. */
export function htmlParaTexto(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,noscript,nav,header,footer,svg,button').forEach((n) => n.remove());
  const out = [];
  const texto = (n) => n.textContent.replace(/\s+/g, ' ').trim();
  const visitar = (n) => {
    for (const c of n.children) {
      const tag = c.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) { const t = texto(c); if (t) out.push('', '# ' + t, ''); }
      else if (tag === 'p' || tag === 'blockquote' || tag === 'figcaption' || tag === 'dd' || tag === 'dt') {
        const imgs = c.querySelectorAll('img');
        imgs.forEach((i) => out.push('[[IMAGEM: ' + (i.getAttribute('alt') || '') + ']]'));
        const t = texto(c); if (t) out.push((tag === 'blockquote' ? '> ' : '') + t, '');
      } else if (tag === 'li') {
        const t = Array.from(c.childNodes).filter((x) => !(x.tagName && /^(UL|OL)$/.test(x.tagName))).map((x) => x.textContent).join(' ').replace(/\s+/g, ' ').trim();
        if (t) out.push('- ' + t);
        c.querySelectorAll(':scope > ul, :scope > ol').forEach(visitar);
      } else if (tag === 'table') { out.push('', '[[TABELA]]', ''); }
      else if (tag === 'img') { out.push('[[IMAGEM: ' + (c.getAttribute('alt') || '') + ']]'); }
      else if (tag === 'br') { /* nada */ }
      else if (c.children.length) visitar(c);
      else { const t = texto(c); if (t) out.push(t, ''); }
    }
  };
  visitar(doc.body);
  return out.join('\n');
}

async function lerDocx(buf) {
  await carregarScript(MAMMOTH);
  const r = await window.mammoth.convertToHtml({ arrayBuffer: buf }, { includeDefaultStyleMap: true });
  return htmlParaTexto(r.value);
}

async function lerPdf(buf, aoProgredir) {
  const pdfjs = await import(PDFJS + 'pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.mjs';
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const linhasDoc = [];
  const alturas = [];
  const paginas = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const pag = await pdf.getPage(p);
    const tc = await pag.getTextContent();
    const linhas = [];
    let atual = null;
    for (const it of tc.items) {
      if (!('str' in it)) continue;
      const y = it.transform[5], x = it.transform[4], h = Math.abs(it.transform[3]) || it.height || 10;
      // nova linha só quando volta para a esquerda ou salta bastante na vertical
      const novaLinha = !atual || Math.abs(atual.y - y) > h * 1.6 || (Math.abs(atual.y - y) > h * 0.4 && x < atual.xFim - h);
      if (novaLinha) {
        if (atual) linhas.push(atual);
        atual = { y, h, t: it.str, xFim: x + (it.width || 0) };
      } else {
        atual.xFim = x + (it.width || 0);
        atual.t += (/\s$/.test(atual.t) || /^\s/.test(it.str) ? '' : (it.str && atual.t ? ' ' : '')) + it.str;
        atual.h = Math.max(atual.h, h);
      }
      if (it.hasEOL && it.str === '' && atual) { /* fim de linha marcado pelo PDF */ }
    }
    if (atual) linhas.push(atual);
    const limpas = linhas.filter((l) => l.t.trim());
    limpas.forEach((l) => alturas.push(Math.round(l.h)));
    paginas.push(limpas);
    if (aoProgredir) aoProgredir(p / pdf.numPages);
  }
  if (!alturas.length) throw new Error('Este PDF parece ser uma imagem escaneada, sem texto selecionável. Use um PDF com texto ou passe o arquivo por um reconhecimento de texto (OCR) antes.');
  const freq = {};
  alturas.forEach((h) => { freq[h] = (freq[h] || 0) + 1; });
  const corpo = Number(Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0]);
  for (const linhas of paginas) {
    for (let i = 0; i < linhas.length; i++) {
      const l = linhas[i];
      const ant = linhas[i - 1];
      const t = l.t.replace(/\s+/g, ' ').trim();
      const grande = l.h > corpo * 1.18 && t.length < 120;
      if (ant && Math.abs(ant.y - l.y) > Math.max(ant.h, l.h) * 1.9) linhasDoc.push('');
      if (grande) linhasDoc.push('', '# ' + t, '');
      else linhasDoc.push(t);
      // fim de parágrafo provável: linha curta terminada em ponto
      if (/[.!?:]$/.test(t) && t.length < 60 && !grande) linhasDoc.push('');
    }
    linhasDoc.push('');
  }
  return linhasDoc.join('\n');
}

export async function extrair(arquivo, aoProgredir) {
  const nome = arquivo.name.toLowerCase();
  const buf = await arquivo.arrayBuffer();
  if (nome.endsWith('.pdf')) return lerPdf(buf, aoProgredir);
  if (nome.endsWith('.docx')) return lerDocx(buf);
  if (nome.endsWith('.doc') || nome.endsWith('.odt') || nome.endsWith('.rtf')) {
    throw new Error('Este formato não é lido diretamente. Abra o arquivo no Word e salve como .docx ou PDF.');
  }
  const txt = decodificar(buf);
  if (nome.endsWith('.html') || nome.endsWith('.htm')) return htmlParaTexto(txt);
  return txt;
}
