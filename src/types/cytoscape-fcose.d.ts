/**
 * cytoscape-fcose 未随包提供类型声明，这里补一个最小声明：
 * 它导出一个符合 cytoscape Ext 签名的扩展注册函数。
 */
declare module 'cytoscape-fcose' {
  import cytoscape from 'cytoscape'

  const extension: (cy: typeof cytoscape) => void
  export default extension
}
