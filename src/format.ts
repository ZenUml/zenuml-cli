import { OutputFormat, ParsedDiagramRecord } from './types.js';
import { extractDiagramContent } from './diagram.js';

function pad(value: string, width: number): string {
  if (value.length >= width) {
    return value.slice(0, width - 1) + '…';
  }

  return value.padEnd(width, ' ');
}

export function printRecords(records: ParsedDiagramRecord[], format: OutputFormat): void {
  if (format === 'json') {
    console.log(JSON.stringify(records, null, 2));
    return;
  }

  if (records.length === 0) {
    console.log('No diagrams found.');
    return;
  }

  const header = [
    pad('ID', 14),
    pad('TYPE', 10),
    pad('TITLE', 28),
    pad('PAGE', 12),
    pad('VERSION', 8),
  ].join(' ');
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const record of records) {
    console.log([
      pad(String(record.id), 14),
      pad(record.value.diagramType, 10),
      pad(record.title || '(untitled)', 28),
      pad(String(record.pageId ?? ''), 12),
      pad(String(record.version?.number ?? ''), 8),
    ].join(' '));
  }
}

export function printRecord(record: ParsedDiagramRecord, format: OutputFormat): void {
  if (format === 'json') {
    console.log(JSON.stringify(record, null, 2));
    return;
  }

  console.log(`ID: ${record.id}`);
  console.log(`Title: ${record.title || '(untitled)'}`);
  console.log(`Type: ${record.value.diagramType}`);
  console.log(`Page: ${record.pageId ?? ''}`);
  console.log(`Version: ${record.version?.number ?? ''}`);
  console.log('');
  console.log(extractDiagramContent(record.value));
}
