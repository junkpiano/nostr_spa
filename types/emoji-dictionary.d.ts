declare module 'emoji-dictionary' {
  const emojiDictionary: {
    getEmoji: (code: string) => string | undefined;
    getName: (emoji: string) => string | undefined;
    getAliases: (code: string) => string[];
  };
  export default emojiDictionary;
}
