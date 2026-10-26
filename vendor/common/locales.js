/* New documents' defaults for the UI's language (docs/i18n.md, Defaults): what a Japanese, Korean, Chinese, French or German
 * Office gives a blank document, workbook and presentation, in the era each app follows (Office 2003 for the page,
 * the fonts and their sizes, as English uses Times New Roman 12 and Arial 10). Applied only to new documents, never
 * to a file that is opened; the user's own Default… settings come first. L.locale.get() is this page's.
 *
 * Where the values come from (python3 tools/locale-defaults.py over the corpora):
 *   ja  Word: the 10 files saved by a Japanese Word (its Normal style justified, without widow control): A4,
 *       margins 1985/1701/1701/1701, header 851, footer 992, a line grid of 360 (18pt), 10.5pt Century with
 *       ＭＳ 明朝, characterSpacingControl compressPunctuation, tab stops every 840 (all 9 or 10 of 10); Excel: ＭＳ Ｐ
 *       ゴシック 11, charset 128, rows 13.5 (6 of 11; Ledger's M.fontRowPt)
 *   ko  Word: 4 files of one Korean Word: A4, margins 1701/1440/1440/1440, header 851, footer 992, no grid, tab
 *       stops every 800; the font (맑은 고딕 10pt in Word, 11 in Excel with rows of 16.5) is Office's known one, not
 *       seen in the corpora: unverified
 * AutoCorrect's quotes follow the language of the text typed (L.locale.quotes), as Word's do.
 *   fr  Word: A4, margins 1417 (24 of 44), header and footer 708 (25 of 44), tab stops every 708 (41 of 44)
 *   de  Word: A4, margins 1417/1417/1134/1417 (53 of 103), header and footer 708 (58 of 103), tab stops every 708
 *       (72 of 103)
 *   zh-CN Word: 103 files with the Chinese Normal style: A4 (89), margins 1440/1800/1440/1800 (76),
 *       header/footer 851/992 (90), 15.6pt grid (97), 10.5pt (91), tabs 420 (102), 宋体 theme (100).
 *   zh-Hant Word: 13 files without widow control: A4 (13), margins 1440/1800/1440/1800 (11), header/footer
 *       851/992 (12), 18pt grid (10), 12pt (12), tabs 480 (12), 新細明體 theme (13).
 *       Both use compressPunctuation. The older Latin face is Times New Roman, as the English default.
 *       Excel: 宋体 11 (3 files) / 新細明體 11 (1); PowerPoint: 宋体 theme (6/10) / 新細明體 (3/3).
 *       Traditional Chinese text is tagged zh-HK, a region tag as Office's (Word ignores zh-Hant: [MS-OI29500] ST_Lang).
 */
(function (root) {
  'use strict';
  const L = root.L || (root.L = {});
  const A4 = { pgW: 595.3, pgH: 841.9, paperCode: 9 };
  const tw = (t) => t / 20;   // twentieths of a point (as the files have them) → points
  const LOCALES = {
    en: {},
    ja: {
      unit: 'cm',
      sect: Object.assign({}, A4, { mt: tw(1985), mr: tw(1701), mb: tw(1701), ml: tw(1701), hdr: tw(851), ftr: tw(992), docGrid: { type: 'lines', linePitch: 360 } }),
      rPr: { font: 'Century', fontEA: 'ＭＳ 明朝', sz: 10.5, lang: 'en-US', langEA: 'ja-JP' },
      pPr: { jc: 'both', widow: false },
      defTab: tw(840), charSpacing: 'compressPunctuation', themeLang: { val: 'en-US', eastAsia: 'ja-JP' },
      themeEA: { minor: 'ＭＳ 明朝', major: 'ＭＳ ゴシック' },
      sheet: { font: 'ＭＳ Ｐゴシック', sz: 11, charset: 128, family: 3, paper: 9 },
      slide: { fontEA: 'ＭＳ Ｐゴシック', lang: 'ja-JP' },
    },
    ko: {
      unit: 'cm',
      sect: Object.assign({}, A4, { mt: tw(1701), mr: tw(1440), mb: tw(1440), ml: tw(1440), hdr: tw(851), ftr: tw(992) }),
      rPr: { font: '맑은 고딕', fontEA: '맑은 고딕', sz: 10, lang: 'en-US', langEA: 'ko-KR' },
      pPr: { jc: 'both', widow: false },
      defTab: tw(800), themeLang: { val: 'en-US', eastAsia: 'ko-KR' },
      themeEA: { minor: '맑은 고딕', major: '맑은 고딕' },
      sheet: { font: '맑은 고딕', sz: 11, charset: 129, family: 3, paper: 9 },
      slide: { fontEA: '맑은 고딕', lang: 'ko-KR' },
    },
    'zh-CN': {
      unit: 'cm',
      sect: Object.assign({}, A4, { mt: tw(1440), mr: tw(1800), mb: tw(1440), ml: tw(1800), hdr: tw(851), ftr: tw(992), docGrid: { type: 'lines', linePitch: 312 } }),
      rPr: { font: 'Times New Roman', fontEA: '宋体', sz: 10.5, lang: 'en-US', langEA: 'zh-CN' },
      pPr: { jc: 'both', widow: false },
      defTab: tw(420), charSpacing: 'compressPunctuation', themeLang: { val: 'en-US', eastAsia: 'zh-CN' },
      themeEA: { minor: '宋体', major: '宋体' },
      sheet: { font: '宋体', sz: 11, charset: 134, family: 2, paper: 9 },
      slide: { fontEA: '宋体', lang: 'zh-CN' },
    },
    'zh-Hant': {
      unit: 'cm',
      sect: Object.assign({}, A4, { mt: tw(1440), mr: tw(1800), mb: tw(1440), ml: tw(1800), hdr: tw(851), ftr: tw(992), docGrid: { type: 'lines', linePitch: 360 } }),
      rPr: { font: 'Times New Roman', fontEA: '新細明體', sz: 12, lang: 'en-US', langEA: 'zh-HK' },
      pPr: { widow: false },
      defTab: tw(480), charSpacing: 'compressPunctuation', themeLang: { val: 'en-US', eastAsia: 'zh-HK' },
      themeEA: { minor: '新細明體', major: '新細明體' },
      sheet: { font: '新細明體', sz: 11, charset: 136, family: 2, paper: 9 },
      slide: { fontEA: '新細明體', lang: 'zh-HK' },
    },
    fr: {
      unit: 'cm',
      sect: Object.assign({}, A4, { mt: tw(1417), mr: tw(1417), mb: tw(1417), ml: tw(1417), hdr: tw(708), ftr: tw(708) }),
      rPr: { lang: 'fr-FR' }, defTab: tw(708), themeLang: { val: 'fr-FR' },
      sheet: { paper: 9 }, slide: { lang: 'fr-FR' },
    },
    de: {
      unit: 'cm',
      sect: Object.assign({}, A4, { mt: tw(1417), mr: tw(1417), mb: tw(1134), ml: tw(1417), hdr: tw(708), ftr: tw(708) }),
      rPr: { lang: 'de-DE' }, defTab: tw(708), themeLang: { val: 'de-DE' },
      sheet: { paper: 9 }, slide: { lang: 'de-DE' },
    },
  };
  /* AutoCorrect's quotes for text in a language: opening and closing double, opening and closing single */
  const QUOTES = { fr: ['«\u00a0', '\u00a0»', '‘', '’'], de: ['„', '“', '‚', '‘'] };
  const lang = () => (root.VO && root.VO.i18n && root.VO.i18n.lang) || 'en';
  L.locale = {
    /** the defaults for new documents in the UI's language (English: none, the apps' own) */
    get: (id) => LOCALES[id || lang()] || LOCALES.en,
    langs: () => Object.keys(LOCALES),
    /** the quotes AutoCorrect types in text of a language (a tag: fr-FR) */
    quotes: (tag) => QUOTES[String(tag || '').slice(0, 2).toLowerCase()] || ['“', '”', '‘', '’'],
    /** an app's saved options (L.store 'opts'), en: those that follow the UI's language, with their English values.
        Options saved before there were languages (no v) kept every value, so one equal to English's is dropped and
        the language's applies */
    savedOpts: (saved, en) => { const o = Object.assign({}, saved || {}); if (!o.v) for (const k in en) if (o[k] === en[k]) delete o[k]; return o; },
    /** the options to save: one that follows the language only when the user chose another value than its default */
    optsToSave: (opts, defaults, en) => { const o = Object.assign({}, opts, { v: 2 }); for (const k in en) if (o[k] === defaults[k]) delete o[k]; return o; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
