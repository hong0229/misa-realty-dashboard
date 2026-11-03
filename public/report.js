/* 인쇄와 PDF 저장 (app.js의 state, $ 사용) */
/* global html2canvas, jspdf */
const PDF_PAGE = { w: 297, h: 210, margin: 8, footer: 7 };
const PDF_WIDTH = 1400; // 항상 넓은 화면 배치로 캡처한다

const reportName = () => {
  const dong = state.dong === '전체' ? '미사지구' : state.dong;
  return `${dong}_부동산브리핑_${state.from}_${state.to}`;
};

function printReport() {
  const title = document.title;
  document.title = reportName();
  window.addEventListener('afterprint', () => { document.title = title; }, { once: true });
  window.print();
}

function pdfTargets() {
  const list = [
    document.querySelector('.brand'),
    $('#reportSummary'),
    $('#kpis'),
    document.querySelector('.top-grid'),
    $('#location'),
    document.querySelector('.listings-panel'),
    ...document.querySelector('.market').children,
    document.querySelector('.footer'),
  ];
  return list.filter((el) => el && !el.hidden && el.offsetHeight > 0);
}

function footerImage(page, total) {
  const c = document.createElement('canvas');
  c.width = 2200;
  c.height = 44;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#6f7a89';
  g.font = '26px Pretendard, "Malgun Gothic", sans-serif';
  g.textBaseline = 'middle';
  g.fillText('센트럴자이 미사금호부동산 · Tel. 031-795-1149', 0, 22);
  g.textAlign = 'right';
  g.fillText(`${page} / ${total}`, c.width, 22);
  return c.toDataURL('image/png');
}

async function capture(el) {
  return html2canvas(el, {
    scale: 2,
    useCORS: true,
    backgroundColor: '#ffffff',
    windowWidth: Math.max(PDF_WIDTH, window.innerWidth),
    logging: false,
    ignoreElements: (node) => node.classList && (node.classList.contains('no-print') || node.classList.contains('leaflet-control-zoom')),
  });
}

// 페이지에 남은 공간을 보고 섹션을 배치한다. 한 페이지보다 많이 길면 잘라서 이어 붙인다
function layoutPages(doc, canvases) {
  const W = PDF_PAGE.w - PDF_PAGE.margin * 2;
  const H = PDF_PAGE.h - PDF_PAGE.margin * 2 - PDF_PAGE.footer;
  const GAP = 3;
  let y = 0;
  let pages = 1;
  const newPage = () => { doc.addPage('a4', 'landscape'); pages++; y = 0; };
  const put = (c, height, width = W) => {
    doc.addImage(c.toDataURL('image/jpeg', 0.88), 'JPEG', PDF_PAGE.margin + (W - width) / 2, PDF_PAGE.margin + y, width, height);
    y += height + GAP;
  };
  const heightOf = (c) => (c.height / c.width) * W;
  canvases.forEach((c, i) => {
    const h = heightOf(c);
    if (c.keepWithNext && y > 0) {
      // 제목과 다음 내용까지 합쳐 들어가지 않으면 미리 다음 페이지로 넘긴다
      let need = h + GAP;
      for (let j = i + 1; j < canvases.length; j++) {
        need += Math.min(heightOf(canvases[j]), H);
        if (!canvases[j].keepWithNext) break;
      }
      if (need > H - y) newPage();
    }
    if (h <= H - y) { put(c, h); return; }
    if (h <= H) { if (y > 0) newPage(); put(c, h); return; }
    if (h <= H * 1.35) { // 살짝 긴 섹션은 축소해 한 페이지에 담는다
      if (y > 0) newPage();
      put(c, H, (c.width / c.height) * H);
      return;
    }
    if (y > 0) newPage();
    const sliceH = Math.floor((H / W) * c.width);
    for (let top = 0; top < c.height; top += sliceH) {
      const part = document.createElement('canvas');
      part.width = c.width;
      part.height = Math.min(sliceH, c.height - top);
      part.getContext('2d').drawImage(c, 0, -top);
      if (top > 0) newPage();
      put(part, (part.height / part.width) * W);
    }
  });
  return pages;
}

async function buildPdf() {
  const canvases = [];
  for (const el of pdfTargets()) {
    const c = await capture(el);
    c.keepWithNext = el.matches('.section-title, .notice'); // 제목이 페이지 끝에 홀로 남지 않게 한다
    canvases.push(c);
  }
  const doc = new jspdf.jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  const total = layoutPages(doc, canvases);
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    doc.addImage(footerImage(p, total), 'PNG', PDF_PAGE.margin, PDF_PAGE.h - PDF_PAGE.margin - 4, PDF_PAGE.w - PDF_PAGE.margin * 2, 3.7);
  }
  return doc;
}

async function savePdf() {
  const btn = $('#savePdf');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'PDF 만드는 중…';
  try {
    await document.fonts.ready;
    const doc = await buildPdf();
    doc.save(`${reportName()}.pdf`);
  } catch (e) {
    showBanner(`PDF를 만들지 못했습니다. 인쇄 버튼에서 'PDF로 저장'을 선택해 주세요. (${e.message})`);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}
