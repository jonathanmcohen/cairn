import { describe, expect, it } from 'vitest';
import { formatApa, formatChicago, formatCitation, formatMla } from '@/lib/citations/format';
import type { CitationMeta } from '@/lib/citations/types';

const ref = {
  authors: ['Smith, J.', 'Doe, A.'],
  title: 'A study of things',
  year: 2024,
  journal: 'Journal of Things',
  doi: '10.1000/xyz',
};

describe('formatCitation', () => {
  it('APA: authors (year). title. Journal. https://doi.org/DOI', () => {
    expect(formatCitation(ref, 'apa')).toBe(
      'Smith, J., & Doe, A. (2024). A study of things. Journal of Things. https://doi.org/10.1000/xyz',
    );
  });

  it('MLA: authors. "title." Journal, year. doi:DOI', () => {
    expect(formatCitation(ref, 'mla')).toBe(
      'Smith, J. and Doe, A. "A study of things." Journal of Things, 2024. doi:10.1000/xyz',
    );
  });

  it('Chicago: authors. "title." Journal (year). https://doi.org/DOI', () => {
    expect(formatCitation(ref, 'chicago')).toBe(
      'Smith, J., and Doe, A. "A study of things." Journal of Things (2024). https://doi.org/10.1000/xyz',
    );
  });

  it('omits doi line cleanly when absent', () => {
    expect(formatCitation({ ...ref, doi: undefined }, 'apa')).toBe(
      'Smith, J., & Doe, A. (2024). A study of things. Journal of Things.',
    );
  });

  it('falls back to pubmed id if no doi', () => {
    expect(formatCitation({ ...ref, doi: undefined, pubmedId: '12345' }, 'apa')).toBe(
      'Smith, J., & Doe, A. (2024). A study of things. Journal of Things. PMID: 12345',
    );
  });
});

// v0.9.0 G3 P21 — CitationMeta formatters (consumed by /api/citations/lookup).
const fullMeta: CitationMeta = {
  source: 'doi',
  authors: [
    { given: 'Jane', family: 'Doe' },
    { given: 'Alex', family: 'Smith' },
  ],
  title: 'A study of widgets',
  year: 2024,
  journal: 'Journal of Widgets',
  volume: '12',
  issue: '3',
  pages: '45-67',
  doi: '10.1234/widget.2024',
  url: 'https://doi.org/10.1234/widget.2024',
};

describe('formatApa (CitationMeta)', () => {
  it('renders full meta in APA 7 style', () => {
    expect(formatApa(fullMeta)).toBe(
      'Doe, J., & Smith, A. (2024). A study of widgets. Journal of Widgets, 12(3), 45-67. https://doi.org/10.1234/widget.2024',
    );
  });

  it('omits missing journal+pages cleanly', () => {
    const sparse: CitationMeta = {
      source: 'pubmed',
      authors: [{ family: 'Doe' }],
      title: 'Untitled',
      year: 2020,
    };
    expect(formatApa(sparse)).toBe('Doe. (2020). Untitled.');
  });
});

describe('formatMla (CitationMeta)', () => {
  it('renders full meta in MLA 9 style', () => {
    expect(formatMla(fullMeta)).toBe(
      'Doe, Jane, and Alex Smith. "A study of widgets." Journal of Widgets, vol. 12, no. 3, 2024, pp. 45-67.',
    );
  });
});

describe('formatChicago (CitationMeta)', () => {
  it('renders full meta in Chicago author-date style', () => {
    expect(formatChicago(fullMeta)).toBe(
      'Doe, Jane, and Alex Smith. 2024. "A study of widgets." Journal of Widgets 12 (3): 45-67. https://doi.org/10.1234/widget.2024.',
    );
  });
});
