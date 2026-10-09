import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from 'docx';

export async function exportToDocx(title: string, paragraphs: string[]): Promise<Blob> {
  const children = paragraphs.map((p) => {
    if (p.startsWith('【此处配图')) {
      return new Paragraph({
        children: [new TextRun({ text: p, italics: true, color: '666666' })],
        spacing: { before: 120, after: 120 },
      });
    }
    if (p.startsWith('## ')) {
      return new Paragraph({
        text: p.slice(3),
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 240, after: 120 },
      });
    }
    if (p.startsWith('# ')) {
      return new Paragraph({
        text: p.slice(2),
        heading: HeadingLevel.HEADING_1,
        alignment: AlignmentType.CENTER,
        spacing: { before: 240, after: 120 },
      });
    }
    return new Paragraph({
      children: [new TextRun({ text: p })],
      spacing: { before: 120, after: 120, line: 360 },
    });
  });

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            text: title,
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.CENTER,
            spacing: { after: 240 },
          }),
          ...children,
        ],
      },
    ],
  });

  return Packer.toBlob(doc);
}
