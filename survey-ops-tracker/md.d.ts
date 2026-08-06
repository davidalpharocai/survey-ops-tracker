// Raw-string imports of markdown files (handled by the webpack asset/source rule in
// next.config.ts). Lets the in-app User Guide import USER_GUIDE.md as text.
declare module '*.md' {
  const content: string
  export default content
}
