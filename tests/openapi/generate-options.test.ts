import { describe, expect, it } from 'vitest';
import { generateOpenApiDocument } from '@/lib/openapi/generate';

describe('generateOpenApiDocument options', () => {
  it('uses the supplied serverUrl + version', () => {
    const doc = generateOpenApiDocument({
      serverUrl: 'https://notes.example.com',
      version: '9.9.9',
    });
    expect(doc.servers?.[0]?.url).toBe('https://notes.example.com');
    expect(doc.info.version).toBe('9.9.9');
  });

  it('falls back to defaults when no options are passed', () => {
    const doc = generateOpenApiDocument();
    expect(doc.info.title).toBe('Cairn API');
    expect(doc.info.version).toBeTruthy();
    expect(doc.servers?.[0]?.url).toBeTruthy();
  });
});
