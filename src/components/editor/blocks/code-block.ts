import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { ReactNodeViewRenderer } from '@tiptap/react';
import type { createLowlight } from 'lowlight';
import { CodeBlockView } from './code-block-view';

/**
 * Curated, ordered language list for the code-block picker. `auto` maps to a
 * null `language` attr (the extension's default), which makes
 * `@tiptap/extension-code-block-lowlight` fall back to `lowlight.highlightAuto`
 * for display — see Task 2. `plaintext` is the explicit no-highlight value.
 * The remaining ids are the popular lowlight `common` languages.
 */
export const LANGUAGES: { value: string; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'plaintext', label: 'Plain text' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'tsx', label: 'TSX' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'jsx', label: 'JSX' },
  { value: 'json', label: 'JSON' },
  { value: 'html', label: 'HTML' },
  { value: 'css', label: 'CSS' },
  { value: 'bash', label: 'Bash' },
  { value: 'python', label: 'Python' },
  { value: 'go', label: 'Go' },
  { value: 'rust', label: 'Rust' },
  { value: 'java', label: 'Java' },
  { value: 'c', label: 'C' },
  { value: 'cpp', label: 'C++' },
  { value: 'sql', label: 'SQL' },
  { value: 'yaml', label: 'YAML' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'diff', label: 'Diff' },
  { value: 'php', label: 'PHP' },
  { value: 'ruby', label: 'Ruby' },
];

/**
 * Factory so both extensions.ts and schema.ts could share one lowlight instance
 * (they each already create one via createLowlight(common)). Only the
 * interactive editor (extensions.ts) calls this; schema.ts stays on the plain
 * CodeBlockLowlight because server-side parsing never renders React NodeViews.
 */
export function createCairnCodeBlock(lowlight: ReturnType<typeof createLowlight>) {
  return CodeBlockLowlight.extend({
    addNodeView() {
      return ReactNodeViewRenderer(CodeBlockView);
    },
  }).configure({ lowlight });
}
