import { describe, expect, it } from 'vitest';
import { formatCitation } from '@/lib/citations/format';

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
