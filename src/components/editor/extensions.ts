import CharacterCount from '@tiptap/extension-character-count';
import Placeholder from '@tiptap/extension-placeholder';
import StarterKit from '@tiptap/starter-kit';

export function baseExtensions() {
  return [
    StarterKit.configure({
      codeBlock: false, // replaced by lowlight in Task 20
      heading: { levels: [1, 2, 3] },
      bulletList: false, // re-added in Task 19
      orderedList: false, // re-added in Task 19
      blockquote: false, // re-added in Task 19
    }),
    Placeholder.configure({
      placeholder: ({ node }) => {
        if (node.type.name === 'heading') return 'Heading';
        return "Type '/' for commands";
      },
    }),
    CharacterCount,
  ];
}
