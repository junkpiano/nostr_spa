declare module 'emoji-dictionary' {
  const emojiDictionary: {
    getUnicode: (code: string) => string | undefined;
    getName: (emoji: string) => string | undefined;
    names: string[];
    unicode: string[];
  };
  export default emojiDictionary;
}
