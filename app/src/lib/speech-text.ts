/** Markdown as it should be read aloud: code blocks named, not spelled out;
 *  links, emphasis and table pipes dropped. No React Native imports: node
 *  --test runs it. */
export function toSpeech(md: string): string {
  return md
    .replace(/```[\s\S]*?(```|$)/g, ' (a code block) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\|?[-:\s|]+\|?\s*$/gm, '')
    .replace(/\|/g, ', ')
    .replace(/(\*\*|__|\*|_|~~)(?=\S)([^*_~]+?)\1/g, '$2')
    .replace(/^>\s?/gm, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
