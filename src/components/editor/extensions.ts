import CharacterCount from '@tiptap/extension-character-count';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Placeholder from '@tiptap/extension-placeholder';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import StarterKit from '@tiptap/starter-kit';
import { common, createLowlight } from 'lowlight';
import { Callout } from './callout-extension';
import { DatabaseNode } from './database-extension';
import { FileAttachment } from './file-extension';
import { CairnImage } from './image-extension';
import { SlashCommand } from './slash-extension';

const lowlight = createLowlight(common);

export function baseExtensions() {
  return [
    StarterKit.configure({
      codeBlock: false,
      heading: { levels: [1, 2, 3] },
    }),
    CodeBlockLowlight.configure({ lowlight }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Callout,
    CairnImage,
    FileAttachment,
    DatabaseNode,
    SlashCommand,
    Placeholder.configure({
      placeholder: ({ node }) => {
        if (node.type.name === 'heading') return 'Heading';
        return "Type '/' for commands";
      },
    }),
    CharacterCount,
  ];
}
