// @vitest-environment jsdom
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { AudioNode } from '@/components/editor/blocks/audio-node';

describe('AudioNode schema', () => {
  it('declares the `cairnAudio` node name, block group, atom', () => {
    expect(AudioNode.name).toBe('cairnAudio');
    expect(AudioNode.config.group).toBe('block');
    expect(AudioNode.config.atom).toBe(true);
  });

  it('inserts an audio node with attributes', () => {
    const editor = new Editor({ extensions: [StarterKit, AudioNode] });
    editor.commands.insertContent({
      type: 'cairnAudio',
      attrs: { fileId: 'abc-123', mime: 'audio/mpeg', name: 'song.mp3' },
    });
    const json = editor.getJSON();
    const audio = json.content?.find((n) => n.type === 'cairnAudio');
    expect(audio?.attrs?.fileId).toBe('abc-123');
    expect(audio?.attrs?.mime).toBe('audio/mpeg');
    expect(audio?.attrs?.name).toBe('song.mp3');
  });

  it('renders to HTML with data-* attrs for static export', () => {
    const editor = new Editor({ extensions: [StarterKit, AudioNode] });
    editor.commands.insertContent({
      type: 'cairnAudio',
      attrs: { fileId: 'abc-123', mime: 'audio/mpeg' },
    });
    const html = editor.getHTML();
    expect(html).toContain('data-cairn-audio');
    expect(html).toContain('data-file-id="abc-123"');
    expect(html).toContain('data-mime="audio/mpeg"');
  });

  it('parses HTML round-trip', () => {
    const editor = new Editor({ extensions: [StarterKit, AudioNode] });
    editor.commands.setContent(
      '<div data-cairn-audio data-file-id="xyz" data-mime="audio/wav"></div>',
    );
    const audio = editor.getJSON().content?.find((n) => n.type === 'cairnAudio');
    expect(audio?.attrs?.fileId).toBe('xyz');
    expect(audio?.attrs?.mime).toBe('audio/wav');
  });

  it('defaults fileId to empty string and mime to audio/mpeg', () => {
    const editor = new Editor({ extensions: [StarterKit, AudioNode] });
    editor.commands.setContent({
      type: 'doc',
      content: [{ type: 'cairnAudio', attrs: {} }],
    });
    const node = editor.getJSON().content?.[0];
    expect(node?.attrs?.fileId).toBe('');
    expect(node?.attrs?.mime).toBe('audio/mpeg');
  });
});

describe('AudioNode Yjs roundtrip', () => {
  it('persists fileId + mime through Yjs', () => {
    const docA = new Y.Doc();
    docA.getMap('audio').set('fileId', 'file-abc');
    docA.getMap('audio').set('mime', 'audio/wav');
    const update = Y.encodeStateAsUpdate(docA);
    const docB = new Y.Doc();
    Y.applyUpdate(docB, update);
    expect(docB.getMap('audio').get('fileId')).toBe('file-abc');
    expect(docB.getMap('audio').get('mime')).toBe('audio/wav');
  });
});
