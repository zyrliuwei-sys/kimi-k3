import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const output = join(process.cwd(), 'artifacts', '产品设计与营销_完整稿.docx');
const work = mkdtempSync(join(tmpdir(), 'product-marketing-docx-'));

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function run(text, { bold = false, color } = {}) {
  const props =
    bold || color
      ? `<w:rPr>${bold ? '<w:b/><w:bCs/>' : ''}${color ? `<w:color w:val="${color}"/>` : ''}</w:rPr>`
      : '';
  return `<w:r>${props}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function paragraph(
  runs,
  style = 'Normal',
  { num = false, continuation = false, rule = false } = {}
) {
  const pPr = [
    `<w:pStyle w:val="${style}"/>`,
    num ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : '',
    continuation ? '<w:ind w:left="540"/>' : '',
    rule
      ? '<w:pBdr><w:bottom w:val="single" w:sz="8" w:space="8" w:color="91A4B6"/></w:pBdr>'
      : '',
  ].join('');
  return `<w:p><w:pPr>${pPr}</w:pPr>${runs.map((item) => (typeof item === 'string' ? run(item) : run(item.text, item))).join('')}</w:p>`;
}

const body = [
  paragraph([{ text: '产品设计与营销', color: '173B5B' }], 'Title'),
  paragraph([{ text: '完整稿', color: '667085' }], 'Subtitle', { rule: true }),
  paragraph([
    '亲自体验了一下，收款极其迅速。你甚至没有感觉到是微信外的一个应用，因为马上就在微信钱包里收到了钱。',
  ]),
  paragraph([
    '付费的内容产品，可能是目前一个新的趋势，比如罗辑思维推出不久的付费的知识性APP“得到”，果壳推出的付费约见APP“在行”。',
  ]),
  paragraph(['但我们今天先不说关于商业模式的事，就说产品设计和营销的关系。']),
  paragraph([
    '很多人以为营销就是发广告、做事件、找大号，其实这有点本末倒置，一个好产品本身就会自带传播功能。',
  ]),
  paragraph(['值乎在产品设计上，至少有几个值得参考的地方：']),
  paragraph(
    [
      { text: '流畅的产品设计，极易上手的操作。', bold: true },
      {
        text: '我可以肯定的说，值乎的产品经理在国内绝对算是1%那一类。这款看起来还像是原型图的产品，用起来几乎不需要学习，立刻就能会意其功能。这种流畅的用户体验，最近半年来，值乎是我看到过最好的一个。当然我说的体验不止是发布和使用，还包括付费和收费等等每个环节。',
      },
    ],
    'ListBody',
    { num: true }
  ),
  paragraph(
    [
      { text: '产品本身的自传播性。', bold: true },
      {
        text: '由于带有游戏性质，使得个人使用和分享的门槛降低，每个人都愿意尝试一下，而且形式新奇有趣，同时还能产生不少有趣有用的内容。这是这款产品能继续在朋友圈传播的关键，否则只靠一部分初始用户，传播会很快衰减下去。这里面有个使用和传播比例的问题。',
      },
    ],
    'ListBody',
    { num: true }
  ),
  paragraph(
    [
      '简单的说，如果你的初始用户是1000个，当这1000个人都使用 并分享到朋友圈之后，假设每个人朋友圈平均可影响的好友是100人，如果看完后能继续产生分享的比例大于1.1%，那么这个分享就是持续增加不会衰减，如果是0.9%或以下，那分享的人数就会持续递减直至归零。所以在这个假设中，分享率0.9%与1.1%的差别是本质性的。',
    ],
    'ListContinuation',
    { continuation: true }
  ),
  paragraph(
    [
      { text: '加入金钱刺激后的动力。', bold: true },
      {
        text: '虽然这个我认为不可持续在朋友圈赚钱，但是第一次在朋友圈让人付费观看，却是一件非常爽的事，这比收到红包还爽，因为不管怎么说，都在证明你自己的价值。',
      },
    ],
    'ListBody',
    { num: true }
  ),
  paragraph([
    '总结起来，就是',
    {
      text: '这款产品解决了分享的动力、使用的门槛、参与的热情三个问题',
      bold: true,
      color: '173B5B',
    },
    '，从而让产品具有了自营销的可能。',
  ]),
  paragraph([
    '当然我这么表扬值乎，并不代表我就看好这是一款终极的好产品。',
    {
      text: '我只是觉得，在自传播这一个事情上，这个产品做得非常好',
      bold: true,
      color: '173B5B',
    },
    '，因为他洞悉到人性中很多东西。',
  ]),
  paragraph([
    '我个人猜测这款产品成为“一阵风”式的现象级产品的可能性很大，除非发生别的改变。',
  ]),
  paragraph([
    '首先是入口没有固定，我在朋友圈里玩了一次，以后再玩就不知道到哪里去找入口了（我当然知道可以翻历史，我只是觉得这样做会很麻烦）。',
  ]),
  paragraph([
    '其次是这个东西作为朋友圈新鲜玩意儿玩一两把可以，持续玩的可能性和吸引度都不够。而且老赚朋友的钱似乎也不合适。',
  ]),
  paragraph([
    '最后是对付费内容的产生，这种方式有点太随意。如果知乎通过这个做出入口，然后马上推出相关更成熟的产品，机会就非常大。但不管怎么说，我都觉得知乎做出这样的东西，比几十家急急忙忙山寨“在行”的应用要明白一万倍。',
  ]),
  paragraph(['说到产品能够自带营销功能，可以再举几个例子。']),
  paragraph([
    '大街网（专注大学生找工作）刚刚创办的时候，如果一个大学生投了一份简历出去，系统就会自动发送一封邮件，提醒这个大学生说有自己同学给你做评价，会更多的获得人力资源的青睐，然后就请你邀请你的三位同学来给你做评价，这个我相信各位懂了。',
  ]),
  paragraph([
    '我们一年前曾经做了一个叫“忽然想起你的”品牌，初期做了200个礼品盒试销，结果送了50个给朋友，因为朋友们都很喜欢，通过晒单，就把剩下的都卖完了。这是因为我们在做包装设计的时候，就在设想用户打开这个礼物，在什么状况下她会比较愿意晒单，然后就把这些促使她晒单的环节设计出来。',
  ]),
  paragraph(['这个项目因某些原因中断，但是我们将在下半年重启这个礼品项目。']),
].join('\n');

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${body}
    <w:sectPr>
      <w:headerReference w:type="default" r:id="rId2"/>
      <w:footerReference w:type="default" r:id="rId3"/>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="709" w:footer="709" w:gutter="0"/>
      <w:cols w:space="720"/>
      <w:docGrid w:linePitch="360"/>
    </w:sectPr>
  </w:body>
</w:document>`;

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Songti SC" w:cs="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="zh-CN" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="0" w:after="120" w:line="300" w:lineRule="auto"/><w:keepLines/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Songti SC" w:cs="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:color w:val="1F2937"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="0" w:after="100"/><w:jc w:val="left"/><w:keepNext/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri Light" w:hAnsi="Calibri Light" w:eastAsia="Songti SC"/><w:sz w:val="52"/><w:szCs w:val="52"/><w:b/><w:color w:val="173B5B"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="0" w:after="280" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Songti SC"/><w:sz w:val="22"/><w:color w:val="667085"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ListBody"><w:name w:val="List Body"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="0" w:after="80" w:line="300" w:lineRule="auto"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="ListContinuation"><w:name w:val="List Continuation"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="0" w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:style>
</w:styles>`;

const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1、"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="540"/></w:tabs><w:ind w:left="540" w:hanging="270"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Songti SC"/></w:rPr></w:lvl></w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;

const headerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="80"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Songti SC"/><w:sz w:val="18"/><w:color w:val="667085"/></w:rPr><w:t>产品设计与营销  ·  完整稿</w:t></w:r></w:p></w:hdr>`;

const footerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="80"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Songti SC"/><w:sz w:val="18"/><w:color w:val="667085"/></w:rPr><w:t>第 </w:t></w:r><w:fldSimple w:instr="PAGE"><w:r><w:rPr><w:sz w:val="18"/><w:color w:val="667085"/></w:rPr><w:t>1</w:t></w:r></w:fldSimple><w:r><w:rPr><w:sz w:val="18"/><w:color w:val="667085"/></w:rPr><w:t> 页</w:t></w:r></w:p></w:ftr>`;

const files = {
  '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
  '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
  'docProps/core.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>产品设计与营销</dc:title><dc:subject>完整稿</dc:subject><dc:creator>Codex</dc:creator><cp:keywords>产品设计, 营销, 自传播</cp:keywords><dcterms:created xsi:type="dcterms:W3CDTF">2026-08-30T00:00:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2026-08-30T00:00:00Z</dcterms:modified></cp:coreProperties>`,
  'docProps/app.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Office Word</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><Company></Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0000</AppVersion></Properties>`,
  'word/document.xml': documentXml,
  'word/styles.xml': stylesXml,
  'word/numbering.xml': numberingXml,
  'word/header1.xml': headerXml,
  'word/footer1.xml': footerXml,
  'word/_rels/document.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`,
};

for (const [path, content] of Object.entries(files)) {
  const destination = join(work, path);
  mkdirSync(destination.slice(0, destination.lastIndexOf('/')), {
    recursive: true,
  });
  writeFileSync(destination, content, 'utf8');
}

rmSync(output, { force: true });
execFileSync('zip', ['-X', '-q', '-r', output, '.'], { cwd: work });
rmSync(work, { recursive: true, force: true });
console.log(output);
